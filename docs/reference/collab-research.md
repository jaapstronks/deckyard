# Real-time collaboration — Phase 0 research report

*2026-07-15. Groundwork for [ADR 001](adr/001-realtime-collaboration.md).
Research question: can Deckyard support Miro/Google-Docs-style multi-user
editing (presence + live edits), what does the codebase give us, and what has
to change?*

Every claim below was verified against the code; file references are
clickable anchors for the implementation phase.

---

## 1. Data model & persistence

### The deck is one JSON blob

A presentation is a single JSON document: metadata + `slides[]` + settings
(`shared/slide-types/presentation.js:25-107`). Each slide is
`{ id, type, parentId, content, notes, visibility }` plus optional
`lockedByAuthor`, `duration`, `dataSource`
(`server/storage/presentations/slides.js:3-39`). Slide `content` is
type-specific and schema-driven (~55 types under `shared/slide-types/types/`),
with nested arrays for items/rows/cards.

Two storage backends sit behind an adapter interface
(`server/storage/adapters/index.js`): **file JSON on disk (default)** and
**Postgres with the deck in a `jsonb` column**
(`server/db/migrations/001_initial_schema.js:56`). In both, slides are
embedded JSON — **there is no per-slide row storage** (the
`postgres/slides.js` module is the slide *library*, not deck slides).

### Writes are whole-deck, with optimistic locking + app-level merge

- The editor saves via `PUT /api/presentations/:id` with the **entire deck**
  as payload (`server/routes/api/presentations/presentation.js:92-180`).
- Concurrency control: integer `revision` + `If-Match` header (HTTP 428 when
  missing, 409 on conflict), plus an `X-Modified-Slides` header that enables a
  **server-side slide-level auto-merge** (`mergeSlidesAtSlideLevel`,
  `server/storage/presentations/crud/helpers.js:74-134`): client's version
  wins for slides it touched, server's for the rest, additions from both kept.
- Every mutation funnels through the facade `updatePresentation`
  (`server/storage/presentations.js:78-93`), which invalidates the 2s read
  cache and notifies live present-sessions over SSE.
- Versions/snapshots are full-document copies with tiered retention
  (`server/storage/presentations/versions.js`), auto-snapshot throttled to one
  per 30 min per deck.

### The i18n structure is the biggest CRDT impedance mismatch

`pres.i18n.versions[lang]` holds a **full parallel copy of the entire slides
array per language**, and top-level `title`/`slides` are re-synced to the
dominant language on every write (`server/storage/presentations/i18n.js:168-258`).
Slide ids are stable across languages, so structure (order, types, nesting) is
duplicated N times and kept consistent only by that normalize step. A naive
CRDT mapping of this shape would have to replicate every structural operation
(reorder, delete, nest) across N language arrays — fragile and pointless.
See ADR §"i18n" for the proposed restructure.

### Atomicity assumptions

Exports, publish, duplicate, validation, size limits, snapshots and the read
cache all treat the deck as one atomic JSON value. This is fine: the plan
keeps JSON as the durable/interchange format and treats the Y.Doc as the live
editing state (ADR §"Persistence").

---

## 2. Editor architecture (client)

### One mutable object, manual re-renders

The editor operates on a single mutable `pres` object fetched once and passed
by reference into every subsystem (`client/views/editor/editor-controller.js:116-155`).
There is **no reactive store** — `client/lib/create-store.js` exists but the
editor doesn't use it. Re-rendering is manual and imperative via late-bound
callbacks (`rerenderSlideList` / `rerenderEditor` / `rerenderPreview`),
consolidated in `client/lib/editor-state.js`.

Mutation flow: input event → closure writes `slide.content[key]` directly →
`markDirty()` (undo capture + 1500 ms debounced autosave) →
`scheduleUiRefresh()` (120 ms debounce → preview re-mount + list item update).

### Three editing surfaces

1. **Form panel** — schema-generated inputs; binding is direct closure
   mutation (`client/views/editor/editor-form/render-field.js:130` and
   friends).
2. **WYSIWYG inline edit** — per-field `contenteditable="plaintext-only"`
   elements addressed by dotted **field-paths** (`"items.0.title"`) with
   `getByPath`/`setByPath` (`client/views/editor/inline-edit/field-path.js`).
   Commit happens **wholesale on blur/Enter** — there is no incremental
   character-level model today. Markdown fields open a modal editor instead.
3. **Slide list drag & drop** — native HTML5 DnD reordering `pres.slides`;
   nesting is expressed via `slide.parentId`, not array nesting.

The field-path system is a gift for CRDT work: it is a stable addressing
scheme (`slideId` + dotted path) that maps 1:1 onto a Y.Map/Y.Array tree.

### Rendering is destructive

`mountSlideInto` wipes `container.innerHTML` and rebuilds the slide DOM from
an HTML string on every change (`client/lib/slide-render.js:240-285`). The
only caret protection is avoidance: preview re-renders are suppressed while
inline editing is active (`editor-controller.js:1038`). Remote updates
arriving mid-edit must respect the same guard (they already do in the existing
SSE refetch path).

### What already exists for multi-user editing

More than expected — Deckyard already has a coarse, lock-based collab layer:

- **Slide-level locks (active)**: acquiring/refreshing/releasing per selected
  slide, DB-backed with 2-min TTL, SSE-broadcast lock events, lock badges in
  the slide list (`client/views/editor/slide-lock-manager.js`,
  `server/storage/slide-locks.js`).
- **Deck-level lock + request/accept turn-taking (dormant)** — short-circuited
  by `useSlideLevelLocking: true` (`client/views/editor/presence-lock.js:28-41`).
- **Remote change push**: an SSE channel per presentation
  (`GET /api/presentations/:id/comments/events`) carries `presentation:updated`
  and `slide:*` lock events; `slide-update-handler.js` refetches and merges
  remote slides live into the open editor, never overwriting the slide the
  user has locked.
- **Conflict UX**: hard 409 → read-only conflict modal (copy JSON / reload);
  soft merge → "See what changed" remote-merge modal.
- **No live presence**: no avatars, no cursors, no "who is looking at what".
  The topbar presence element exists but is fed nothing in slide-lock mode.

So today's model is: *invalidate & refetch, slide-level last-write-wins,
locks to keep people off each other's slide*. A CRDT layer replaces exactly
this — and the seams it hangs off (the SSE events, the lock manager, the
update handler) are where the Yjs binding will plug in.

### Undo is the incompatible piece

Undo is whole-deck `structuredClone` snapshots (max 50, 400 ms grouping)
(`client/lib/undo-manager.js`, `editor-controller.js:323-340`). Remote merges
bypass it, so an undo after a remote edit restores a pre-merge deck — already
subtly wrong today, and fundamentally incompatible with concurrent editing.
`Y.UndoManager` (scoped to local origin) is the designed replacement.

---

## 3. Server & transport

- **Plain `node:http`, no framework**, single process, manual routing
  (`server/server.js:41-104`). Port 4177, one `server.listen`.
- **All realtime today is SSE** (five separate in-process subsystems:
  comments/locks/presentation-updated, notifications, present-sessions,
  follow ticker, MCP). **No WebSocket anywhere**; `ws` is not a dependency;
  there is no `server.on('upgrade')` handler.
- **Same-port precedent**: the MCP Streamable-HTTP transport is mounted on the
  same HTTP server at `/mcp` (`server/server.js:97`). A WS upgrade handler for
  collab follows the same pattern; Caddy proxies WebSockets transparently, so
  `Caddyfile`/compose need no changes.
- **Redis is optional** and already plumbed (`ioredis` + `bullmq` installed;
  graceful fallback everywhere, `server/utils/redis-client.js`). Today it does
  rate-limiting + job queues only — there is **no cross-instance pub/sub**;
  all live state is process-local Maps. Deckyard is effectively
  single-instance for realtime (known limitation; unchanged by this plan).
- **Feature flags**: `server/config/feature-flags.js` aggregates flags exposed
  to the client (`client/lib/features.js`). A `collab` flag slots straight in.
- **Tests**: `node --test`; best templates are `tests/mcp/mcp-sse.test.js`
  (transport mounted on the HTTP server) and
  `tests/present-sessions-deck-updated.test.js` (broadcast path).

---

## 4. Auth & permissions

- **Sessions are stateless HMAC-signed cookies** (`sb_session`,
  `server/auth/auth.js:112-164`), sent automatically on a same-origin
  WebSocket upgrade. The sync server can reuse `getUserFromRequestAsync(req)`
  on the upgrade request as-is.
- **Canonical write check** to reuse in the sync auth hook:
  `getPresentation` + `getCollaboratorPermission` (Redis/LRU-cached, 5-min
  TTL) + `canWritePresentation`
  (`server/utils/route-middleware.js:223-248`,
  `server/utils/presentation-authz/presentations.js:42-64`). Permission
  levels: `view`/`comment`/`edit`/`admin`.
- **Share-link guests can never edit** (comment/view only,
  `server/utils/presentation-authz/guests.js`) → guests connect read-only,
  presence-visible but without document write.
- **API keys** (`dk_live_*`, scopes `read/write/export/ai`) authenticate the
  public API and the MCP SSE transport.

### ⚠ Pre-existing authz gaps surfaced by this research

Two inconsistencies exist today, independent of collab, and should be fixed
*before* wiring machine clients into a shared live document:

1. **MCP mutating tools perform no per-deck authorization at all** —
   `update_slide`, `add_slide`, `remove_slide`, `reorder_slides`,
   `iterate_presentation`, `append_slides`, `convert_slide`,
   `compress_presentation` fetch any deck by id and write it without an
   owner/collaborator/scope check (`server/mcp/tools.js:503-956`).
2. **The public API uses a weaker check** (`canAccessPresentation`:
   owner/workspace only, ignores the collaborator table,
   `server/routes/public-api/v1/middleware.js:111-126`).

---

## 5. Server-side mutation paths (the split-brain question)

The complete inventory of code paths that mutate a deck (21 paths, table in
the research transcript) reduces to one architectural fact:

> **Every server-applied deck write already funnels through
> `updatePresentation` in `server/storage/presentations.js:78`.**

That includes: MCP tools, public API v1 (whole-deck and per-slide), AI wizard
deck creation, translate routes **and the background translate worker**,
change-theme, scope changes, version restore, publish metadata, and
import-slides-as-images. The AI *editing* endpoints (`iterate`, `refine`,
`append-slides`, `convert-slide`, `compress`) and data-source refresh are
**client-applied**: they return suggestions and the editor persists them
through the normal save path — in a CRDT world they automatically go through
the client's Y.Doc, no changes needed.

This means the server-as-collaborator problem has a single choke point: teach
`updatePresentation` (the facade) to detect an active collab document and
apply the incoming JSON as a diff to the Y.Doc (via Hocuspocus
`openDirectConnection().transact()`) instead of writing the row directly.
No individual MCP tool or route needs to learn about Yjs. See ADR
§"Server-side mutations".

---

## 6. Constraints checked

- **No bundler on the client**: `yjs`, `y-protocols` and
  `@hocuspocus/provider` must be vendored as a one-time ESM bundle (same
  pattern as `scripts/vendor-lucide.js` → `client/vendor/`), keeping the
  no-build app code untouched.
- **Hocuspocus status (verified 2026-07)**: v4.3 current, MIT, actively
  maintained, requires Node 22+ (matches `engines`), runs on the existing
  HTTP server, has `onAuthenticate`/`onLoadDocument`/`onStoreDocument` hooks
  and `openDirectConnection` for server-side edits.
- **CRDT library landscape (verified 2026-07)**: Yjs remains the production
  default (largest ecosystem, no WASM, framework-agnostic). Automerge's
  advantage is git-like history (not our product need; we have snapshots);
  Loro is fastest but its encoding/API are still marked experimental. No
  concrete reason found to deviate from Yjs. Sources: see ADR.

## 7. Conclusion

Feasible, as an optional layer, without a framework rewrite. The codebase has
unusually good seams for this: a single mutation choke point on the server, a
stable field-path addressing scheme on the client, an SSE/lock layer whose UX
concepts (per-slide focus, merge toasts) carry over, and auth that works on a
WS handshake unchanged. The genuinely hard parts are (1) the per-language
duplicated slides arrays and (2) replacing snapshot undo — both are bounded,
known refactors, detailed in the ADR. A full frontend rewrite (Svelte etc.)
is not needed and would not even help with the hardest sub-problem
(character-level text merging needs a Y.Text binding regardless of
framework). Recommendation and phasing: [ADR 001](adr/001-realtime-collaboration.md).
