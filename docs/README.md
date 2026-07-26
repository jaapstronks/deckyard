# Documentation

## Map

| Folder | What lives there |
|--------|------------------|
| `docs/developer/` | Contributor docs: architecture, dev setup, themes, slide types, i18n, API |
| `docs/reference/` | Stable "how it works" docs: MCP server, fork setup, font management, AI prompts, feature deep-dives |
| `docs/ops/` | Operations: self-hosting / VPS deploy guide |
| `docs/adr/` | Architecture decision records (historical; only the status line is kept current) |
| `docs/plans/` | Planning workspace: worklist, strategy, per-item briefings. A **symlink to a private sibling repo**, and **gitignored** here — absent on a fresh clone, and none of it ships with the OSS repo. Indexed from `docs/plans/TODO.md` |
| `docs/openapi.yaml` | OpenAPI spec — stays at this path, the server serves it at `/api/v1/openapi.yaml` |

User documentation (getting started, configuration, hosting, integrations) lives at
**https://github.com/jaapstronks/deckyard-website** (docs folder).

## Working method for ongoing development

Three planning horizons, three files — the first two are private, only the third
ships:

1. **`docs/plans/TODO.md`** — *now*: the operational worklist (in progress /
   queue / recently done), always current. Open this file to decide what to work
   on. **`docs/plans/STRATEGY.md`** — *later, internal*: directional tracks with
   rationale, not yet public. **`/ROADMAP.md`** (repo root) — *public
   commitment*: one line per project, grouped Now / Next / Later.
2. Each planned item has an elaborated briefing in
   **`docs/plans/briefs/<slug>.md`**: problem, scope with file references, and a
   "done when". The three anchors (`TODO.md`, `STRATEGY.md`, `README.md`) sit at
   the `docs/plans/` root; the per-item briefings live one level down in
   `briefs/`. Write the briefing before starting the work; it's what a fresh
   session (or agent) picks up.
3. **After implementation**, the full write-up moves to the month archive
   **`docs/plans/done/YYYY-MM.md`** (newest first), `TODO.md` keeps only the last
   five as a one-line glance, and the brief is either **deleted** (the work
   speaks for itself) or its durable parts are **converted into
   `docs/reference/`** (when future sessions will need it as documentation).
   Then remove the line from `ROADMAP.md`.

   **What "durable" means in practice**: if the work established a convention
   that the next contributor has to follow — a scale, an escaping rule, a
   removal checklist — it belongs in `docs/reference/`, not only in the
   worklist. `docs/plans/` is gitignored, so anything left there is invisible to
   everyone outside this machine.
4. Reference docs describe **what is**, plans describe **what should change**.
   If a doc mixes both, split it.

## For contributors

| Goal | Start here |
|------|------------|
| Architecture overview | `docs/developer/architecture.md` |
| Dev environment | `docs/developer/dev-setup.md` |
| Adding custom themes | `docs/developer/themes.md` |
| Adding custom slide types | `docs/developer/slide-types.md` |
| What a new slide type owes elsewhere | `docs/reference/slide-type-companions.md` |
| Removing a slide type | `docs/reference/slide-type-removal.md` |
| CSS design tokens (spacing, z-index) | `docs/reference/css-tokens.md` |
| CSS breakpoints | `docs/reference/css-breakpoints.md` |
| Internationalization | `docs/developer/i18n.md` |
| REST API | `docs/developer/api.md` + `docs/openapi.yaml` |
| MCP server | `docs/reference/mcp-server.md` |
| Comments & notifications model | `docs/reference/comments-and-notifications.md` |
| Setting up a fork | `docs/reference/fork-setup.md` |
