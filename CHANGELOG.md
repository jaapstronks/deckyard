# Changelog

Notable changes to Deckyard. The format follows
[Keep a Changelog](https://keepachangelog.com/); given the project's pace,
entries are grouped per release rather than exhaustively listed.

## [Unreleased]

### Added

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
