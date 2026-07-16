# Changelog

Notable changes to Deckyard. The format follows
[Keep a Changelog](https://keepachangelog.com/); given the project's pace,
entries are grouped per release rather than exhaustively listed.

## [Unreleased]

### Added

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
