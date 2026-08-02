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
| The full list of built-in slide types | `docs/reference/slide-type-inventory.md` (generated) |
| Whether something is a new type or a variant | `docs/reference/slide-type-structure.md` |
| Which types we promise, and what a second implementation owes | `docs/reference/slide-type-tiers.md`, `docs/reference/deck-conformance.md` |
| What a new slide type owes elsewhere | `docs/reference/slide-type-companions.md` |
| Removing a slide type | `docs/reference/slide-type-removal.md` |
| CSS design tokens (spacing, z-index) | `docs/reference/css-tokens.md` |
| CSS breakpoints | `docs/reference/css-breakpoints.md` |
| Which `!important` are by design | `docs/reference/css-important.md` |
| Renaming a class a slide type emits | `docs/reference/slide-type-css-contract.md` |
| Internationalization | `docs/developer/i18n.md` |
| REST API | `docs/developer/api.md` + `docs/openapi.yaml` |
| MCP server | `docs/reference/mcp-server.md` |
| Comments & notifications model | `docs/reference/comments-and-notifications.md` |
| Setting up a fork | `docs/reference/fork-setup.md` |

## Full index

The table above is the task-oriented entry point; this is the complete list, so
nothing is discoverable only by `ls`.

**Contributor guides** (`docs/developer/`)

| Doc | What it covers |
|-----|----------------|
| [`architecture.md`](developer/architecture.md) | Directory structure, handler chain, render pipeline |
| [`dev-setup.md`](developer/dev-setup.md) | Local development environment |
| [`contributing.md`](developer/contributing.md) | Contribution workflow and conventions |
| [`slide-types.md`](developer/slide-types.md) | Adding a custom slide type + AI integration |
| [`themes.md`](developer/themes.md) | Adding custom themes |
| [`i18n.md`](developer/i18n.md) | Internationalization |
| [`api.md`](developer/api.md) | Public API developer guide |
| [`linting.md`](developer/linting.md) | Lint setup and the suppressions burndown |
| [`export-smoke-test.md`](developer/export-smoke-test.md) | Export smoke test |
| [`migration-smoke-test.md`](developer/migration-smoke-test.md) | Migration smoke test — every migration up/down/up against a real PostgreSQL |
| [`live-data-sources-testing.md`](developer/live-data-sources-testing.md) | Live data sources testing checklist |

**Slide types**

| Doc | What it covers |
|-----|----------------|
| [`slide-type-inventory.md`](reference/slide-type-inventory.md) | The built-in types (generated from the registry) |
| [`slide-type-directory.md`](reference/slide-type-directory.md) | The directory form a type ships in |
| [`slide-type-structure.md`](reference/slide-type-structure.md) | The `structure` facet, and type vs variant |
| [`slide-type-runtime.md`](reference/slide-type-runtime.md) | The `runtime` facet — what the presenting session does for a type |
| [`slide-type-groups.md`](reference/slide-type-groups.md) | The `group` axis — which shelf a type is offered on |
| [`slide-type-tiers.md`](reference/slide-type-tiers.md) | The three tiers and the `fallback` facet — which types we promise |
| [`slide-type-companions.md`](reference/slide-type-companions.md) | What a new type owes elsewhere |
| [`slide-type-removal.md`](reference/slide-type-removal.md) | Retiring a type without leaving rot |
| [`custom-slide-types-frontend.md`](reference/custom-slide-types-frontend.md) | The in-app custom-type editor |
| [`text-alignment.md`](reference/text-alignment.md) | Who decides alignment, and why |
| [`slide-copy-language.md`](reference/slide-copy-language.md) | Which language a type's built-in copy speaks |
| [`team-cards-original-aspect.md`](reference/team-cards-original-aspect.md) | `imageAspect: original` layout |
| [`video-slide-pdf-export.md`](reference/video-slide-pdf-export.md) | Video slides in PDF export |

**Editor & editing surfaces**

| Doc | What it covers |
|-----|----------------|
| [`editing-surfaces.md`](reference/editing-surfaces.md) | Canvas vs inspector vs own surface — the principle |
| [`editor-inspector.md`](reference/editor-inspector.md) | The inspector rail, panes and toolbar zones |
| [`wysiwyg-inline-editing.md`](reference/wysiwyg-inline-editing.md) | Inline editing on the slide canvas |
| [`editor-responsive-fields.md`](reference/editor-responsive-fields.md) | Size-intent field rows |
| [`image-property-ownership.md`](reference/image-property-ownership.md) | Where each image property lives |
| [`image-picker-seam.md`](reference/image-picker-seam.md) | The shared image-picker seam |
| [`insert-slide-picker.md`](reference/insert-slide-picker.md) | The insert-slide picker |
| [`deck-creation-and-reuse.md`](reference/deck-creation-and-reuse.md) | Slide library, collections, reuse |
| [`home-view.md`](reference/home-view.md) | The home view |
| [`export-menu.md`](reference/export-menu.md) | The editor export menu |

**Theming & styling**

| Doc | What it covers |
|-----|----------------|
| [`theme-config.md`](reference/theme-config.md) | Database themes |
| [`theme-slide-backgrounds.md`](reference/theme-slide-backgrounds.md) | Theme-defined background variants |
| [`slide-background-contrast.md`](reference/slide-background-contrast.md) | Background images, contrast and overlays |
| [`contrast.md`](reference/contrast.md) | The one contrast implementation |
| [`nested-surfaces.md`](reference/nested-surfaces.md) | Text on a panel, bar or card that paints its own background |
| [`css-tokens.md`](reference/css-tokens.md) | CSS design tokens (app chrome) |
| [`css-breakpoints.md`](reference/css-breakpoints.md) | The shared breakpoint ladder |
| [`css-important.md`](reference/css-important.md) | Every `!important`, by-design vs cascade-patch |
| [`slide-type-css-contract.md`](reference/slide-type-css-contract.md) | The class names a slide type emits are a public contract |
| [`font-management.md`](reference/font-management.md) | Font management |

**Agents, AI & API**

| Doc | What it covers |
|-----|----------------|
| [`mcp-server.md`](reference/mcp-server.md) | MCP tools, prompts, transports |
| [`mcp-test-prompt.md`](reference/mcp-test-prompt.md) | A manual MCP test script |
| [`ai-wizard-prompts.md`](reference/ai-wizard-prompts.md) | The deck-generation prompts |
| [`ai-slide-review.md`](reference/ai-slide-review.md) | Deck grid, batch review, section refine |
| [`api-error-format.md`](reference/api-error-format.md) | The internal API error envelope |
| [`comments-api.md`](reference/comments-api.md) | Comments via public API v1 + MCP |

**Formats & export**

| Doc | What it covers |
|-----|----------------|
| [`deck-format.md`](reference/deck-format.md) | The `deckyard.deck` interchange format |
| [`deck-conformance.md`](reference/deck-conformance.md) | The two conformance levels a second implementation can claim |
| [`deck-bundle-format.md`](reference/deck-bundle-format.md) | The `.deck` bundle |
| [`standalone-html-export.md`](reference/standalone-html-export.md) | Standalone HTML export |
| [`reflowable-html-export.md`](reference/reflowable-html-export.md) | Reflowable "reader" export |
| [`bulk-export.md`](reference/bulk-export.md) | Bulk export / backup |
| [`pdf-export-performance.md`](reference/pdf-export-performance.md) | What makes a PDF export heavy, and how to measure it |

**Presenting & collaboration**

| Doc | What it covers |
|-----|----------------|
| [`two-window-presenter.md`](reference/two-window-presenter.md) | The two-window presenter view |
| [`live-video-layer.md`](reference/live-video-layer.md) | The live video layer |
| [`comments-and-notifications.md`](reference/comments-and-notifications.md) | The three-layer comments model |
| [`collab-presence.md`](reference/collab-presence.md) | Collaborator presence |
| [`collab-deck-doc.md`](reference/collab-deck-doc.md) | CRDT schema, serializer, persistence |
| [`collab-editor-binder.md`](reference/collab-editor-binder.md) | Live edits in the editor |
| [`collab-research.md`](reference/collab-research.md) | Phase 0 research (dated snapshot) |
| [`../adr/001-realtime-collaboration.md`](adr/001-realtime-collaboration.md) | ADR 001 — Yjs + Hocuspocus |

**Operating an instance**

| Doc | What it covers |
|-----|----------------|
| [`../ops/self-hosting.md`](ops/self-hosting.md) | VPS deploy guide |
| [`../ops/agent-install.md`](ops/agent-install.md) | Install Deckyard with an AI agent |
| [`fork-setup.md`](reference/fork-setup.md) | Setting up a fork |
| [`tenant-isolation.md`](reference/tenant-isolation.md) | Organizations and isolation shapes |
| [`security-posture.md`](reference/security-posture.md) | Server-side hardening controls, what each blocks, and where it lives |
| [`maintenance-mode.md`](reference/maintenance-mode.md) | Deploying without failing saves in open editors |
| [`sso-oidc.md`](reference/sso-oidc.md) | SSO via OIDC (single IdP) |
| [`versioning.md`](reference/versioning.md) | Versioning & releases |
| [`html-escaping.md`](reference/html-escaping.md) | Escaping and `innerHTML` in the client |
| [`dynamic-imports.md`](reference/dynamic-imports.md) | When a dynamic `import()` is justified, and where they survive |
