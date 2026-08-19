# Notion import

Turning a Notion page into a deck, and pushing the finished deck back onto that
page. Written 2026-08-05 against HEAD.

Notion appears in Deckyard in three unrelated places, and only the first is what
people mean by "the Notion integration":

1. **Import** — read a page, run it through the AI pipeline, get a deck. Plus
   the return trip: append an embed of the deck to the page it came from.
2. **The AI wizard's subject picker** — a feature-gated shortcut that offers
   recent Notion pages as raw input for deck generation.
3. **Data-source bindings** — `notion-database` and `notion-block` providers
   that fill slide fields from live Notion data, on the same low-level client.

All three share one API client, one integration token and one block parser.
This document covers all three, because splitting them would leave the shared
seam undescribed.

## Purpose & scope

Deckyard talks to Notion as a **single-tenant integration**: one internal
integration token in `NOTION_SECRET`, instance-wide, shared by every user. There
is no OAuth flow and no per-user connection — what the integration can read is
what a Notion workspace admin has explicitly shared with it, which is why every
error path in these routes says "make sure the page is shared with your Notion
integration".

The import path itself is a **source adapter in front of the AI pipeline**, not
a converter. Nothing maps a Notion block onto a slide type directly: the page is
flattened to structured text (headings become section boundaries, tables and
images are lifted out), that text goes into the same two-phase generation
pipeline that file conversion uses, and the pipeline decides the slides. See
[`ai-pipeline.md`](ai-pipeline.md) for what happens after the hand-off.

## Module map

The client and parser (`server/utils/notion/`, 5 modules, 772 lines):

- `server/utils/notion/client.js` — the HTTP client: token, `Notion-Version`
  header, a token-bucket rate limiter, error normalization to
  `err.statusCode`, and `fetchAllBlockChildren()` cursor pagination.
- `server/utils/notion/parser.js` — pure block → text functions:
  `richTextToPlain`, `pageTitleFromProperties`, `blockTextLine`,
  `extractImageFromBlock`, and `extractPageId` (URL or raw id → 32-hex id).
- `server/utils/notion/pages.js` — page-level reads: search, rich content
  extraction with sections/images/tables, the AI text formatter, and two
  plain-text variants (full and a cheap preview).
- `server/utils/notion/blocks.js` — block _writers_: divider, heading,
  paragraph, embed, callout, `appendBlocksToPage`, and
  `publishEmbedToNotionPage`.
- `server/utils/notion/index.js` — the barrel (the sole public seam; every
  importer goes through it).

The conversion step:

- `server/utils/convert-notion.js` — `convertNotionPage()`: extract, upload
  images, format for the AI, run outline → refine → validate, return a deck plus
  a report.

The routes (`server/routes/api/notion/`, 7 modules, ~770 lines) behind one
dispatcher:

- `server/routes/api/notion.js` — the dispatcher: status, fetch and publish
  always; import and stream-import always; subjects, compose and suggest only
  when the `enableNotion` flag is on.
- `server/routes/api/notion/status.js` — `GET /api/notion/status`.
- `server/routes/api/notion/fetch.js` — `POST /api/notion/fetch` and
  `POST /api/notion/publish`.
- `server/routes/api/notion/import.js` — `POST /api/notion/import` and
  `POST /api/notion/import/stream`.
- `server/routes/api/notion/subjects.js` — `POST /api/notion/subjects` and
  `POST /api/notion/compose` (flagged).
- `server/routes/api/notion/suggest.js` — `POST /api/notion/suggest` (flagged).
- `server/routes/api/notion/utils.js` — keyword extraction, the
  "is this a usable document?" heuristic, and `handleNotionError`.
- `server/routes/api/notion/index.js` — the barrel.

The second consumer:

- `server/utils/data-source/providers/notion.js` — the `notion-database` and
  `notion-block` data-source providers. It imports
  `server/utils/notion/client.js` and `parser.js` **directly**, not through
  the barrel, and never touches the import routes.

Client surfaces:

- `client/views/list/modals/new-presentation/handlers.js` — the import flow
  (streaming, with a non-streaming fallback).
- `client/views/editor/share-dropdown.js` +
  `client/views/editor/share-dropdown/share-actions.js` — the "publish to
  Notion" action, shown only when status reports the integration is on.
- `client/views/list/modals/creation-view/content-compose.js` — reads status
  for the creation view.

## Data model

Deckyard stores **no Notion content of its own** — no page cache, no sync state,
no token per user. Two things persist:

| Where                                                 | What                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentations.notion_source_page_id` (migration 001) | The normalized 32-hex page id a deck was imported from. Written by both import routes and by the AI wizard when it carries one; exposed as `notionSourcePageId` (`mapPresentationRow` in `server/storage/presentations/index.js`). It exists for exactly one feature: knowing which page to append the embed to. |
| `NOTION_SECRET` (environment)                         | The integration token. Not in the database, not per organization.                                                                                                                                                                                                                                                |

The intermediate shape that never persists is worth naming, because three
modules pass it around. `extractRichContentFromPage()` returns:

```
{ title, pageId, sections: [{ heading, textContent, images[], tables[] }],
  allImages: [...], metadata: { lastEdited } }
```

A **section** starts at every `heading_1` or `heading_2`; everything else
accumulates into the current one. Tables are fetched as child blocks and kept
both structurally and as a pipe-delimited text rendering; images are lifted into
`images[]` and referenced in the text as `[Image: caption]`.

## Flows

### 1. Import a page (the main path)

`POST /api/notion/import/stream` — the flow the UI uses. The non-streaming
`POST /api/notion/import` is the same work with one JSON response.

1. Refuse with **501** `notion_not_configured` when `NOTION_SECRET` is unset.
2. `extractPageId(body.url)` — accepts a bare 32-hex id, a UUID with dashes, or
   a `notion.so` / `notion.site` URL in any of its shapes. Anything else is a
   400 before a request leaves the process.
3. Open an SSE stream and send staged `status` events (fetch → convert →
   finalize → save) with a progress percentage.
4. `convertNotionPage()`:
   - `extractRichContentFromPage()` — one `GET /pages/{id}` for the title, then
     paginated `GET /blocks/{id}/children` up to 600 blocks, recursing into
     children up to depth 3.
   - Re-host every extracted image so the deck stays durable: to ImageKit when it
     is configured, otherwise through Deckyard's own media library (see
     _Implementation status_).
   - `formatNotionContentForAi()` — flatten to the `NOTION PAGE: …` /
     `=== CONTENT ===` text block.
   - Run the two-phase pipeline: `generateOutline` →
     `separateSlidesForProcessing` → `refineAllSlideGroups` →
     `validateAndFixRefinedSlides`, forwarding the pipeline's own status
     messages onto the SSE stream.
5. On a deck with no errors, `createPresentation` + `updatePresentation`, stamping
   `notionSourcePageId`, then a `complete` event carrying the presentation and
   the conversion report.

The report is part of the contract, not debug output: it counts sections,
images, tables and slides, and lists warnings and per-slide issues.

### 2. Publish the deck back to the page

`POST /api/notion/publish` with `{ pageId, embedUrl, title?, lang? }` →
`publishEmbedToNotionPage()` appends four blocks to the bottom of the page: a
divider, an `heading_2`, an `embed`, and a linked paragraph. It **appends**
(`PATCH /blocks/{id}/children`); nothing on the page is replaced, and repeated
publishes stack.

The editor only offers this when `GET /api/notion/status` reports `enabled` and
the deck carries a `notionSourcePageId`.

### 3. Fetch raw text

`POST /api/notion/fetch` returns `{ title, content, pageId }` — the page as
plain text, depth 3, 600 blocks, with no AI involved. Available whenever Notion
is configured.

### 4. The flagged wizard shortcut

Only reachable with `NOTION_FEATURE` on:

- `POST /api/notion/subjects` — search (or list recent) pages, walk at most 20
  of them, fetch a cheap preview of each, and return the first three that pass
  `looksLikeUsableDoc()` (≥700 characters, or ≥300 across two paragraphs). Each
  subject carries a keyword extracted from its title.
- `POST /api/notion/compose` — given a `pageId` and/or a `keyword`, gather up to
  three pages' plain text and return it as one `raw` blob for the wizard, with a
  `meta` block naming the mode and how many pages were examined.
- `POST /api/notion/suggest` — the older single-shot form: the most recently
  edited page's text.

The lookup caps (`MAX_LOOKUPS` 20 / 12 / 6) exist because each candidate costs
at least one Notion request and the rate limiter is shared instance-wide.

### 5. Data-source bindings

Independent of everything above. `notion-database` runs
`POST /databases/{id}/query` and flattens each row's properties to scalars —
title, rich text, number, select, multi-select, date, checkbox, url, email,
phone, formula, rollup, status; anything else becomes `''`. `notion-block`
fetches up to 50 child blocks of a page and returns their text lines. Bindings
address the result positionally: `row[0].Revenue`, `block[2].text`.

### 6. Rate limiting and errors

A single module-level **token bucket** in `client.js` (capacity 10, refilling 3
tokens/second) fronts every Notion call the process makes — imports, the wizard
shortcut and data-source providers all draw from it. Exhausting it throws
immediately with `statusCode: 429` and a `retryAfterMs`; it does not queue.

Notion's own errors are normalized once, in `notionFetchJson`: the response
message becomes `err.message`, the HTTP status becomes `err.statusCode`. Route
handlers then map 404 and 401/403 to the "share the page with your integration"
message, which is the actual cause nine times out of ten.

## Config & flags

| Variable                  | Effect                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTION_SECRET`           | The internal integration token. Unset → `notionEnabled()` is false and every Notion route answers **501** `notion_not_configured`. This is the only switch import and publish need.     |
| `NOTION_FEATURE`          | Turns on the flagged wizard endpoints (`subjects`, `compose`, `suggest`) via `enableNotion` in `server/config/flags-snapshot.js`. Forced off in demo mode.                              |
| `IMAGEKIT_*`              | When configured, imported images are re-hosted through ImageKit. See [`media-library.md`](media-library.md).                                                                            |
| `enableAi` (feature flag) | Does **not** gate the Notion routes — the dispatcher runs before the AI gate — but the import path calls the AI pipeline, so an install with AI off has an import that cannot complete. |

`GET /api/notion/status` reports both switches to the client as `enabled`
(token present) and `fullFeatures` (token present _and_ flag on), so the UI
never offers a button that can only 501.

## Authz & tenancy

- **Every Notion route sits behind the login gate.** `handleNotion` is
  dispatched from `server/routes/api/index.js` _after_ the
  `authEnabled() && !authedUser → 401` check, so the individual handlers do no
  authentication of their own.
- **There is no per-deck authorization**, because the import creates a deck
  rather than acting on one. The created deck is owned by the importer
  (`ownerEmail`), and everything after that follows
  [`permission-model.md`](permission-model.md).
- **The integration token is instance-wide.** Any authenticated user of the
  instance can read any page the Notion integration can read, and append an
  embed to any page it can edit. That is a property of a single-token
  integration, not a bug — but it means the Notion side of the boundary is the
  workspace admin's sharing decision, not Deckyard's.
- **Tenancy** rides on the storage scope of the created presentation, per
  [`tenant-isolation.md`](tenant-isolation.md) R1. Nothing Notion-specific is
  organization-scoped: the token, the rate limiter and the feature flag are all
  instance-global (R3).

## Implementation status

Normative target: **one import path, one client, one barrel.** Where the code
stands, as of 2026-08-17:

- **The import path works as described** and is the only Notion surface the app
  actually drives, together with publish and status.
- **The dropped-parameter defect is fixed and pinned.** An earlier dispatcher
  passed only `{ req, res, url, authedUser, repoRoot }` to the import handlers,
  so `storageScope` arrived `undefined` and `createPresentation(undefined, …)`
  threw. The route-table dispatch (#686) forwards the full context, and
  `tests/c8-routes-notion-dispatch.test.js` pins that the exact `storageScope`
  reaches the import handler (#784).
- **Four endpoints have no caller.** `fetch`, `subjects`, `compose` and
  `suggest` are not called from any client module; only `status`,
  `import/stream`, `import` and `publish` are. `suggest` additionally describes
  itself as backwards-compatible with a shape nothing sends. They are candidates
  for the finish-or-strip list, not documented promises.
- **Imported images are durable on both paths.** Notion's file-hosted image URLs
  are signed and expire (roughly an hour), so `processNotionImages` re-hosts every
  image: to ImageKit when it is configured, otherwise through Deckyard's own media
  library (the configured media provider — local `/uploads` or S3). Either
  way the block URL is rewritten to a durable one before the deck is saved. If an
  individual image cannot be fetched or stored, that one image falls back to the
  original (expiring) URL rather than failing the import (B80, D29-1).
- **Import is synchronous and unbounded in wall-clock.** The conversion runs
  inside the request (an SSE stream held open), not on the job queue, and the
  only limits are the block caps (600 blocks, depth 3) and the AI pipeline's own
  behaviour. See [`jobs-and-queues.md`](jobs-and-queues.md) for the queue this
  path does not use.
