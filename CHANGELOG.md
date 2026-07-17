# Changelog

Notable changes to Deckyard. The format follows
[Keep a Changelog](https://keepachangelog.com/); given the project's pace,
entries are grouped per release rather than exhaustively listed.

## [Unreleased]

### Added

- **Image-text layout catalogue, phase 1: width series, corner layout and a
  layout switcher.** The image-text slide's width enum gains `wide` (63%);
  the existing `narrow` (37%) doubles as the catalogue's 1/3 split, so no
  fourth value or data migration was needed. A new `layout` enum adds the
  corner variant: the image sits only in the top corner and the space below
  stays deliberately empty (mirrors via the existing image-position toggle,
  which stays orthogonal to the variants). A new "Layout" chip in the slide
  toolbar opens a tile popover with mini-schematics per variant - current
  variant marked, one click switches while the content stays put, one undo
  step per switch. The "Text without image" tile is the zeroth variant and
  runs through the phase 0 convert seam. Variants are declared on the
  slide-type definition (`layoutVariants`, JSON-safe, served via
  `/api/slide-types`), so forks that override the type by name control
  their own set. Insert-picker presets, inspector enums (deliberately
  doubled), the AI catalogue (including a "little text room" hint for wide
  and corner) and both export paths (pdf-slides, standalone HTML) moved
  along; browser-verified end to end.

- **Add/remove an image directly in the WYSIWYG editor.** A text slide gets
  a "+ Add image" chip on the edit canvas: clicking it turns the slide into
  an image-text slide (same id, notes, comments and URL) and opens the media
  popover on the fresh placeholder. On an image-text slide, an empty image
  placeholder gets a hover-× that removes the reserved image area and turns
  the slide back into a text slide; a filled image must be cleared first, so
  removal is a deliberate two-step. Both affordances run through the existing
  convert seam, are declarable by custom slide types, and the lossy-fields
  confirm no longer fires on enum defaults (only on real content such as a
  filled image, caption or alt text). Phase 0 of the image-text layout
  catalogue.

- **Comments in the public API v1 + MCP write tools.** Agents/scripts with
  an API key can now read reviewer comments and respond to them: new
  endpoints `GET/POST /api/v1/presentations/:id/comments` and
  `POST /api/v1/comments/:id/status` behind new key scopes `comments:read`
  and `comments:write`; new MCP tools `add_comment`, `reply_to_comment` and
  `set_comment_status` (core tool count 24 → 27). Comment payloads carry
  current slide context, a `slideSnapshot` of the slide as it was when the
  comment was created (migration 041, `null` for older comments), a `since`
  filter and an `editUrl` deep link anchored to the commented slide. MCP
  edit links also got fixed to point at the real editor route (`/app/:id`;
  `/edit/:id` never existed). See `docs/reference/comments-api.md`.

- **Selected slide in the editor URL.** Navigating slides in the editor (and
  the view/comment viewer) now updates `?slideId=` via `replaceState`, so a
  refresh reopens the same slide and a copied URL is a shareable deep link
  to that slide. No history entry per slide; the deck language param is
  preserved.

- **Unified Background section in the slide form.** Background colour, custom
  background image (with focus/fit/overlay) and the theme corner logo now
  live in one "Background" section, instead of a loose colour dropdown at the
  top plus a separate collapsed "Background & logo" panel. Open by default
  (sticky per user). Also fixes the freeform slide's custom-colour input,
  which never rendered because the colour field renderer wasn't passed
  through to the form.
- **Logo wall: up to 30 logos, background colour.** The cap was 12; beyond 12
  the grid switches to fluid 7/8-wide columns so any count lays out cleanly,
  and small counts keep rendering larger (the 11-12 tier got a slight size
  bump). The slide also gained the standard background colour option
  (defaults to its historical mist look; theme background variants work too).

- **Editor loading skeleton.** Opening a deck used to show a blank white
  page until everything was fetched (seconds, on long decks). The editor
  route now mounts a shimmer skeleton of the real three-column layout
  immediately, with a spinner + "Loading presentation…" status in the
  canvas, honoring `prefers-reduced-motion`. Loading also got faster: the
  presentation is no longer fetched twice back-to-back, and theme /
  slide-type / asset requests now run in parallel.

- **Real-time collaboration (opt-in, feature-flagged).** With
  `COLLAB_ENABLED=true`, everyone with the same deck open sees live
  presence: topbar avatars, a name label + dot on the slide each person is
  viewing (gliding along when they move), and focus rings + name labels on
  the field someone is editing. With `COLLAB_LIVE_EDITS=true` on top, the
  deck becomes a shared CRDT document (Yjs/Hocuspocus over a `/collab`
  WebSocket on the same port): edits merge live at character level,
  undo/redo is per-user, presenter notes support genuine co-typing, and
  server-side writes (AI, MCP, public API, translate, theme change) appear
  live in open editors. Slide locks are retired while the flag is on;
  autosave and conflict modals are inert (the server persists debounced).
  Both flags default off; with them off, behavior is byte-for-byte
  unchanged. Postgres installs need migration 040 (`presentation_ydocs`).
  See `docs/reference/collab-presence.md`, `collab-deck-doc.md`,
  `collab-editor-binder.md` and ADR 001.

### Fixed

- **Stale browser tabs can no longer silently overwrite other users' work.**
  A tab that slept through remote saves (laptop lid, offline) used to
  autosave its days-old copy straight over newer edits: the slide-level
  merge let the stale client win per slide, adopted its slide order
  wholesale, and reported nothing. Fixed in two rounds (#45, #46):
  - a staleness cap on the merge route (`MERGE_MAX_REVISION_GAP`, default
    10) falls back to the existing 409 + conflict modal;
  - per-slide conflict detection via base fingerprints
    (`X-Slide-Base-Fingerprints`): a slide changed on both sides since the
    client's base now 409s with `conflictingSlides` instead of
    last-writer-wins;
  - the merge only applies the client's slide order when the client
    actually reordered (`X-Slides-Order-Changed`); otherwise the server
    order is authoritative — slides added by others stay at their position
    instead of being appended, client-new slides are woven in next to
    their neighbour;
  - waking tabs refresh themselves: on tab-visible/focus/online the editor
    probes the new lightweight `GET /api/presentations/:id/revision`
    endpoint and silently adopts the server state (clean) or saves through
    the normal merge/conflict flow (dirty) before the user can type into
    stale content;
  - every performed merge is audited as a `presentation.merged` activity
    event, and a merge by a client more than one revision behind first
    writes an automatic `pre_merge` snapshot to the version history for
    one-click restore.

- **Security: Home/overviews no longer leak decks without view access.**
  Three related fixes, all enforcing the same invariant (a deck card — title
  + first-slide thumbnail — is only visible when the user could also open
  the deck): (1) `GET /api/presentations` (and search) no longer shows
  ownerless "legacy" decks to every authenticated user; (2) the popular rail
  no longer surfaces private-but-published decks with dead links into the
  app view; (3) the activity unread badge now counts only events on decks
  the user can read (a fresh user used to see an org-wide count). The same
  legacy exception was removed from the public API's listing filter.

- **Security: per-deck authorization for machine clients (MCP + public
  API).** MCP tools that fetch a deck by id performed no per-deck check at
  all: any configured MCP session (or any API key, via the SSE transport)
  could read, edit or delete any deck by id. And the public API used an
  owner/workspace-only check with no read/write distinction that ignored
  the collaborator table. Both surfaces now use the same collaborator-aware
  `canRead`/`canWritePresentation` checks as the editor routes.
  **Breaking for integrations that leaned on the old, too-permissive
  behavior:**
  - API keys can no longer *write* to workspace decks that are view-only or
    starter kits, nor to private decks of other users (previously possible
    whenever the deck had `scope: workspace`, and via MCP for any deck).
  - MCP `delete_presentation` is now owner-only.
  - API keys of collaborators (view/comment/edit/admin) now get access to
    decks shared with them, matching their permission level — reads that
    previously returned 403 now succeed.
  - Unchanged: stdio MCP without `DECKYARD_MCP_OWNER_EMAIL` remains a
    trusted local session (no per-deck checks), and per-deck *listing*
    (`GET /api/v1/presentations`) still returns owned + workspace decks.
- Presentation owners can delete any comment on their own deck (#1)

### Changed

- **Editor chrome re-organized: slide-scoped vs. deck-scoped.** The right
  rail is now driven by an always-visible labeled pane switcher
  (Inspector / Comments / Notes) at the far right of the topbar; presenter
  notes moved from a permanent block under the canvas into their own rail
  pane (with the Notes-QR companion flow in its header). Everything about
  the current slide (type chip, "All text", lock, the slide actions menu)
  sits in a toolbar above the canvas; the topbar keeps deck-level actions,
  with Companion tucked into a Present split-menu and utilities (AI
  analysis, settings, shortcut help) in the ⋯ menu. The legacy
  "collapse slide panel" mode - which could trap the editor in a
  super-wide inspector - is gone, removing a card in an icon-cards slide
  really removes it (a stale legacy count kept a ghost slot), and the
  "Edit all text" modal got substantially roomier.
- **The editor is now wysiwyg-first.** The slide canvas covers all content
  editing in place: inline text everywhere, add/remove of repeatable items
  (including text-blocks rows and blocks), drag-reorder via an overlay grip,
  and adding a first image to an empty slot. A new **"Edit all text" modal**
  shows every content field in one list next to a live preview, with
  prev/next navigation across the deck. The old form column became a slim
  **Inspector** on the right: a toggleable rail with a settings pane
  (background, layout/variant enums, accessibility; no more content text
  fields) and a comments pane that replaces the separate comments slide-over
  and the thread list under the slide. Below 1100px the editor converges on
  two columns with the inspector as a full-width row under the canvas.
  Slide locks are now also enforced server-side (423 on content writes to a
  locked slide). See `docs/reference/editor-inspector.md`.
- Stock background photos replaced with generated demo gradients
- CI and Docker on Node 22 (matches `engines`)

## [1.0.0] — 2026-07-14

### Added

- First public open-source release 🎉
- 38 typed slide types with a shared schema → render → editor pipeline
- AI deck generation, iteration, analysis and validation (BYO LLM: OpenAI,
  Claude, Mistral, DeepSeek, or any OpenAI-compatible endpoint)
- MCP server (22 tools, 6 guided prompts) over stdio and SSE
- Live presenting: speaker console, two-window presenter, audience
  follow-along with polls, Q&A and feedback
- Theming system with custom themes, custom slide types and fork-friendly
  `custom/` directories
- Exports: PDF, PPTX, standalone HTML, PNG; embed SDK
- i18n groundwork for 12 locales (en/nl fully populated)
