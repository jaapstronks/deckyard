# Documentation

## Map

| Folder | What lives there |
|--------|------------------|
| `docs/developer/` | Contributor docs: architecture, dev setup, themes, slide types, i18n, API |
| `docs/reference/` | Stable "how it works" docs: MCP server, fork setup, font management, AI prompts, feature deep-dives |
| `docs/ops/` | Operations: self-hosting / VPS deploy guide |
| `docs/plans/` | Active project briefings (**gitignored** — local working docs). Indexed from `/ROADMAP.md` |
| `docs/openapi.yaml` | OpenAPI spec — stays at this path, the server serves it at `/api/v1/openapi.yaml` |

User documentation (getting started, configuration, hosting, integrations) lives at
**https://github.com/jaapstronks/deckyard-website** (docs folder).

## Working method for ongoing development

1. **`docs/plans/TODO.md`** is the operational worklist: in progress / queue /
   recently done, always current. Open this file to decide what to work on.
   **`/ROADMAP.md`** (repo root) is the coarser public overview: one line per
   project, grouped Now / Next / Later / Ideas.
2. Each active project has an elaborated briefing in **`docs/plans/<slug>.md`**:
   problem, scope with file references, and a "done when". Write the briefing
   before starting the work; it's what a fresh session (or agent) picks up.
3. **After implementation**, a plan file is either **deleted** (the work speaks
   for itself) or its durable parts are **converted into `docs/reference/`**
   (when future sessions will need it as documentation). Then move its
   `TODO.md` entry to *Recently done* and remove the line from `ROADMAP.md`.
   `docs/plans/done/` is a temporary parking spot for finished plans awaiting
   that conversion.
4. Reference docs describe **what is**, plans describe **what should change**.
   If a doc mixes both, split it.

## For contributors

| Goal | Start here |
|------|------------|
| Architecture overview | `docs/developer/architecture.md` |
| Dev environment | `docs/developer/dev-setup.md` |
| Adding custom themes | `docs/developer/themes.md` |
| Adding custom slide types | `docs/developer/slide-types.md` |
| Internationalization | `docs/developer/i18n.md` |
| REST API | `docs/developer/api.md` + `docs/openapi.yaml` |
| MCP server | `docs/reference/mcp-server.md` |
| Setting up a fork | `docs/reference/fork-setup.md` |
