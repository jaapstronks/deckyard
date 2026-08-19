# Publishing

Making a deck readable on the open web: the publish flow, the public pages it
mints, and the feed that lists them. Written 2026-08-05 against HEAD.

Publishing is one of three ways a deck leaves the logged-in app, and the only
one that produces a durable, indexable, guessable-length public URL. The other
two are **share links** (a long token, revocable, optionally password- or
email-gated — [`permission-model.md`](permission-model.md)) and **follow codes**
(a short code with a 24-hour TTL — [`live-sessions.md`](live-sessions.md)). They
are not variants of each other: publishing is the one with no expiry, no token
secrecy and search-engine metadata.

## Purpose & scope

Publishing turns a deck into a **public token plus a rendered page**. The token
is an 8-hex `publishId`; the page is the same standalone HTML the export
pipeline produces, wrapped in Open Graph, Twitter and JSON-LD metadata and an
analytics tracking script. Unpublishing deletes the token, and the URL 404s
immediately.

The publish id _is_ the authorization. Everything downstream — the canvas page,
the reader view, the embed player, the feed — resolves the id first and then
fetches the deck by the id that lookup yielded, on a deliberately
organization-unscoped storage scope. There is no session on any of those
requests, so there is nothing else the authorization could rest on. That is one
of the named `crossOrganizationScope` cases in
[`tenant-isolation.md`](tenant-isolation.md).

## Module map

Publish / unpublish:

- `server/routes/api/publish.js` (301 lines) — the app's four routes: publish,
  unpublish, rename the slug, regenerate the preview image.
- `server/routes/public-api/v1/publishing.js` (197 lines) — the machine-client
  equivalents: publish, publish status, unpublish.
- `server/storage/published/index.js` (224 lines) — the storage facade:
  `newPublishId`, `getPublishedById`, `upsertPublishedEntry`,
  `removePublishedEntry`, `updatePublishedSlug`, `getPublishedIndex`,
  `listPublishedForFeed`.
- `server/render/preview-image.js` + `server/render/og-image.js` — the OG image:
  render the first meaningful slide, or pick one out of the deck's content.
- `server/utils/slug.js` — `safeSlug()`, which derives the URL slug from a
  title.

The public pages:

- `server/routes/static/published.js` — `/p/:id-:slug` (canvas) and
  `/p/:id-:slug/reader` (reflowable reading view).
- `server/routes/static/embed.js` — `/embed/:id-:slug`, the iframe player.
- `server/export/html.js` / `server/export/reader.js` — the two renderers, shared
  with export. See [`standalone-html-export.md`](standalone-html-export.md) and
  [`reflowable-html-export.md`](reflowable-html-export.md).

The feed:

- `server/routes/feed.js` (131 lines) — `/feed/rss.xml`, `/feed/atom.xml`,
  `/feed/feed.json`.
- `server/utils/rss-feed.js` (64 lines) — `buildFeed()`, all three formats from
  one model via the `feed` package.
- `server/routes/static/app-shell.js` — `injectFeedDiscovery()`, the
  `<link rel="alternate">` autodiscovery tags.

Client surfaces:

- `client/views/editor/publish-export/publish.js` — the publish panel.
- `client/views/editor/modals/settings-modal/toggles.js` — the per-deck
  `excludeFromFeed` toggle.
- `client/views/settings/tabs/integrations-tab.js` — the organization's RSS
  settings and the feed URLs.

## Data model

**`published_presentations`** (migration 001) — one row per published deck:

| Column                      | Notes                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | The publish id: the first segment of a UUID, 8 hex characters. Primary key, and the public token.                                    |
| `presentation_id`           | FK, `ON DELETE CASCADE` — deleting a deck unpublishes it.                                                                            |
| `organization_id`           | FK. Used by the listing and the feed; _not_ by `getPublishedById`, which is deliberately unscoped.                                   |
| `title`, `slug`             | The slug comes from `safeSlug(title)` at publish time and can be renamed afterwards. It is cosmetic: the id alone resolves the deck. |
| `og_image_url`              | The generated preview, or the fallback asset.                                                                                        |
| `created_at`, `modified_at` |                                                                                                                                      |

The same facts are mirrored onto **`presentations.published`** (a JSONB column,
migration 001) as `{ id, slug, ogImageUrl, created, modified }`, so exports and
the editor UI can see publish state without a second query. Unpublishing writes
an explicit `null` there rather than deleting the key — the storage layer reads
an absent key as "leave this column alone", so dropping it would leave the deck
published in the database.

**Per-deck**: `presentations.settings.excludeFromFeed` — published, but not
listed in the feed.

**Per-organization**: `organizations.settings.rss` (JSONB; migration 038 is a
deliberate no-op that only reserves the number) — `enabled`, `title`,
`description`, `language`, `copyright`, `authorName`, `customFeedUrl`,
`maxItems`.

## Flows

### 1. Publish

`POST /api/presentations/:id/publish`:

1. **Sandbox refuses outright** (403). A guest owns a private deck and could
   otherwise push arbitrary content onto a public domain; this mirrors
   `canChangePresentationVisibility` returning false there.
2. `withPresentationAuth(… permission: 'write')` — publishing is a write, so
   collaborators with `edit` can do it, viewers cannot.
3. Reuse the existing publish id if the deck was published before, otherwise
   mint one. **Re-publishing keeps the URL.**
4. Generate the OG image: find the first slide that is not a
   `follow-invite-slide`, load the theme, and render it through
   `generateAndSaveOgPreview` — optionally with an author overlay when
   `settings.ogPreview.showAuthor` is set, taking the name and avatar from the
   owner's profile. Every failure path falls back:
   no media provider or a render error → `pickOgImageUrlFromPresentation`, and
   failing that, a bundled default asset.
5. `upsertPublishedEntry` (which derives the slug from the title), then mirror
   the entry onto `presentations.published`.
6. Warm the deck-grid thumbnail, fire the `presentation.published` webhook
   ([`webhooks.md`](webhooks.md)), and answer with
   `{ publishId, slug, path, ogImageUrl }`.

`PATCH …/publish/slug` renames the slug (400 if the deck is not published);
`POST …/preview/regenerate` re-runs step 4 alone.

### 2. Unpublish

`DELETE /api/presentations/:id/publish` — write access, then
`removePublishedEntry` and an explicit `published: null` on the deck. No
webhook fires. The public URL 404s on the next request; nothing is cached
server-side, and the pages are served `Cache-Control: no-store`.

### 3. The public canvas page

`GET /p/:id-:slug`:

1. Resolve the publish id on a cross-organization scope. Unknown id → 404.
2. Fetch the deck the entry points at, same scope. Gone → 404.
3. **Canonicalize**: a missing or wrong slug 302s to `/p/<id>-<slug>`. The id is
   what resolves; the slug is presentation.
4. Project to a language — `?lang=` or the deck's own setting — and build a
   `<head>` with `robots`, a canonical link, an alternate pointing at the reader
   view, Open Graph, Twitter card, and a `PresentationDigitalDocument` JSON-LD
   block (with `<` escaped so a value cannot break out of the script).
   Sandbox instances emit `noindex,nofollow`.
5. Render with `buildStandaloneHtml` in `context: 'published'`, adding the
   analytics head and tracking script, a language switcher when a second
   language version exists, and a visible link to the reader view.

`GET /p/:id-:slug/reader` is the same resolution with `buildReaderHtml`: a
JS-optional, semantic, reflowable projection of the same deck, canonicalized
back to the canvas URL.

`GET /embed/:id-:slug` is the iframe player. It differs in two deliberate ways:
a **missing** slug is accepted rather than redirected (simple iframe embeds stay
working), and a render failure returns a styled HTML page rather than JSON or a
thrown error, because the result is displayed inside someone else's page.

### 4. The feed

`GET /feed/rss.xml` | `/feed/atom.xml` | `/feed/feed.json` — public, no auth,
and gated four times before it serves anything:

1. `RSS_FEED_ENABLED` — the instance kill switch. Off → 404.
2. `MULTI_ORG_ENABLED` → **404**. The feed has no session to resolve an
   organization from, so it uses the default one, which stops being a defined
   answer once an instance holds several organizations (org-scoping decision 4 in
   `tenant-isolation.md`).
3. The organization must resolve. Missing → 404.
4. `organizations.settings.rss.enabled` — the real user-facing toggle. Off → 404.

Then: `listPublishedForFeed` sorts published entries by modified date, enriches
up to `maxItems` (clamped 1–100, default 50) with deck metadata, and **skips any
deck with `excludeFromFeed`**. An ETag is computed from the newest modified
timestamp so `If-None-Match` gets a 304, and the response carries
`Cache-Control: public, max-age=300`.

`buildFeed` emits RSS 2.0, Atom 1.0 or JSON Feed 1 from one item model: title,
link (`/p/<id>-<slug>`), description, dates, author and image. The base URL is
`settings.rss.customFeedUrl` when set, otherwise derived from the request.

**Autodiscovery** is injected into the app shell by `injectFeedDiscovery()`
under exactly the same conditions as the routes — kill switch on,
multi-organization off, organization toggle on — so the `<link>` tags and the
routes can never disagree.

### 5. Publishing from the public API

`POST` / `GET` / `DELETE /api/v1/presentations/:id/publish` do the same work for
an API key, authorized by scope (`write` / `read`) plus deck access. The response
shapes match the app's, plus a `GET` that answers `{ isPublished: false }` or
the full publish state.

## Config & flags

| Variable / setting                            | Effect                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RSS_FEED_ENABLED`                            | Instance kill switch for the feed. **Defaults to on**; set it false to remove the feature.                                                                              |
| `MULTI_ORG_ENABLED`                           | Disables the feed and its autodiscovery links entirely (404 / omitted).                                                                                                 |
| `SANDBOX_MODE`                                | Publishing is refused with 403; published pages that do exist emit `noindex,nofollow`.                                                                                  |
| `organizations.settings.rss.*`                | Per-organization: `enabled` (the real toggle), `title`, `description`, `language`, `copyright`, `authorName`, `customFeedUrl`, `maxItems`.                              |
| `presentations.settings.excludeFromFeed`      | Per-deck: published, but not listed.                                                                                                                                    |
| `presentations.settings.ogPreview.showAuthor` | Per-deck: overlay the owner's name and avatar on the generated preview image.                                                                                           |
| Media provider                                | Preview generation needs an initialized media provider ([`media-library.md`](media-library.md)); without one, publishing still succeeds with a picked or default image. |

## Authz & tenancy

- **Publishing and unpublishing require deck _write_ access** — owner, creator,
  a collaborator with `edit`/`admin`, or an organization member on an organization deck.
  See [`permission-model.md`](permission-model.md). Publishing is not a separate
  capability, and there is no reviewer or approval step.
- **Reading a published deck requires nothing at all.** The three public routes
  and the feed take no session, no cookie and no header. A published URL handed
  to anyone works for anyone.
- **The publish id is the authorization**, so all four read paths declare
  `crossOrganizationScope(repoRoot, '<reason>')`. Filtering them by organization
  would 404 every public link the moment an instance holds a second organization.
  Reads only — such a scope cannot reach a write or a listing.
- **The feed is the exception that proves it**: it is a _listing_, so it must
  state an organization, and having nothing but the default one to state is
  exactly why multi-organization turns it off.
- **What a published page exposes**: title, description, every slide the
  `published` visibility filter admits, the theme, and — in the feed only — the
  local-part of the owner's email as a display handle. The raw address is never
  published.

## Implementation status

Normative target: **one publish concept, one set of routes per client kind, one
public page family.** Where the code stands, as of 2026-08-05:

- **The publish/unpublish flow and the public pages match the target**, and the
  publish-id-is-the-authorization rule is applied consistently across all four
  read paths.
- **Publish state is stored twice**: the `published_presentations` row and the
  `presentations.published` JSONB mirror. Every write path updates both in the
  same handler, and the mirror exists so exports and the deck grid need no
  second query — but it is a denormalization with no constraint behind it, and
  the explicit-`null` comment in two places is a scar from it drifting once.
- **The app route and the v1 route have drifted.** `POST /api/v1/…/publish` does
  **not** apply the sandbox refusal and does **not** fire the
  `presentation.published` webhook, both of which the app route does. One
  concept, two behaviours, decided by which client asks — the kind of divergence
  the beta doctrine says to collapse rather than document as intended. The
  sandbox half is more than a style point: a sandbox guest counts as
  authenticated and can mint an API key, so that chain routes around the 403.
- **The OG-preview block is copied three times** — twice in
  `server/routes/api/publish.js` (publish and regenerate) and once in
  `server/routes/public-api/v1/publishing.js` — with the same
  first-meaningful-slide search, the same author-overlay lookup and the same
  fallback ladder. It wants to be one function.
- **The feed serves the default organization or nothing.** The 404 under
  multi-organization is a deliberate refusal, not a limitation being hidden, and it
  stands until a per-organization or per-author feed is designed
  (`tenant-isolation.md`, decision 4).
- **Unpublishing is silent.** No webhook, no activity event, no notification —
  while publishing fires a webhook. Whether that asymmetry is intended has not
  been decided.
