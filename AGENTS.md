## AGENTS README (LLM + human maintainers)

Deckyard is **simple, dependency-light and modular**: plain Node.js + vanilla ESM on server and client, **no bundler**, strict **separation of concerns**. Optimize for **maintainability, extendability and DRY**; don't “just patch it in place”. When in doubt, copy the _structure_ of an existing feature (not its text or styles).

This file holds the rules every session weighs. Each bullet that points at a doc names when to read it; the full map of the docs is `docs/README.md`.

---

## Repo architecture (high-level)

- **`shared/`**: logic used by both server and client. **Slide types are the canonical source of truth** (schema, fields, defaults, HTML rendering); `shared/markdown.js` is the safe markdown subset they use.
- **`client/`**: browser UI, no build step. `client/views/` holds features, `client/lib/` the layer that owns no feature (see _Client layers_); `client/styles/` splits app chrome from slide styling.
- **`server/`**: HTTP adapters in `server/routes/`, shared domain operations in `server/services/` (internal API, public v1 and MCP; `docs/reference/services-layer.md`), persistence in Postgres behind `server/storage/` (every function takes a `StorageScope` first, `docs/reference/storage-scope.md`), export builders in `server/export/`, browser rendering in `server/render/`, HTTP/authorization/validation helpers in `server/utils/`.
- **`themes/`**: theme JSON resolved at runtime into CSS variables (don’t brand the app chrome). **`assets/`**: fonts and images for slides and UI.

---

## The project’s “non-negotiables” (conventions)

- **Single source of truth for slide types**: they live in `shared/slide-types/types/*.js`, are registered in `shared/slide-types/registry.js`, and both sides consume them through `shared/slide-types.js`; the editor fetches their metadata from `GET /api/slide-types`.
- **No bundler; keep it readable**: small modules, no new dependency without a strong reason.
- **Formatting: Prettier.** For formatting, ignores and generators, read `docs/developer/linting.md` § Formatting (commands and rules).
- **Dependencies**: before changing package declarations or gated imports, read `docs/reference/dynamic-imports.md` § Which packages are optional. It defines hard, optional and fork-only dependencies.
- **Module layout: one folder = one seam.** Before decomposing modules or moving imports, read `docs/developer/architecture.md` § One folder = one seam for public entries, naming, storage/client boundaries and the single shim exception.
- **Client layers: `lib/` is a layer, `views/` is a feature** (D263, D264). A module that **fetches a feature's records and renders them is a view**, however many pages use it: one owner → inside that view, two or more → its own `views/<feature>/` with an `index.js` seam. **`lib/` never imports from `views/`**; across features, import only `views/<feature>/index.js`. Feature-less shared UI has one address: `lib/dom/`. `tests/client-layer-direction.test.js` pins it without an allowlist; the closed list of what `lib/` holds is in `docs/developer/architecture.md` § One folder = one seam.
- **Separation of concerns**: shared slide-type modules describe schema, defaults and **pure HTML rendering** (no DOM side effects, no fetch, no timers); client runtime behaviour attaches to rendered markup in `client/lib/*` or view controllers, with cleanup.
- **Theming & styling boundaries**: theme variables are scoped to `.slide`, so the app UI stays theme-independent; slide CSS reads `--slide-*` roles, app CSS the `--ps-*`/`--app-*`/`--z-*` tokens from `client/styles/shared/ui-tokens.css`, and never the other way round. No hardcoded brand colours or fonts in slide templates. Before adding or moving a stylesheet, read `docs/reference/css-layers.md` (layer order, feature folders, generated aggregators).
- **Avoid hardcoded copy scattered across templates**: UI copy lives in view-specific modules (follow-along: `createFollowCopy(lang)` in `client/views/follow/i18n.js`, resolved against the _deck_ language); slide-specific static copy in a per-slide `COPY` map keyed by language (see `follow-invite-slide`).
- **API error envelope (internal `/api/*`)**: one shape, `{ ok:false, error:'<machine_code>', message?, details? }`, produced through the `server/utils/http.js` helpers or `jsonError()`, never a hand-rolled `serveJson(res, status, { error })`; the client reads `err.code` / `err.message` from `api()`. SSE `error` events and failed background jobs have their own shapes. Read `docs/reference/api-error-format.md` before adding an error path; the public `/api/v1/*` keeps its openapi schema.
- **Safety: HTML escaping and markdown**: user text into HTML goes through `escapeHtml()` (`shared/slide-types/helpers.js`) or `markdownToSafeHtml()` (`shared/markdown.js`); XML sinks (PPTX, SVG) use `escapeXml()` (`shared/xml.js`). No third copy. Data-driven markup uses `h()`; a new `innerHTML` write must fit a safe category in `docs/reference/html-escaping.md`.
- **Lifecycle & cleanup (critical in this codebase)**: any runtime side effect (EventSource, timers, window listeners, observers) returns a cleanup function that runs when the slide DOM is replaced (`__sbCleanup` in `client/lib/slide-runtime/slide-render.js`). A client factory returns **`{ el, detach }`**; disposal goes through `disposeAll()` (`client/lib/dom/disposal.js`). Rationale: `docs/developer/architecture.md` § Critical Convention: Lifecycle & Cleanup.

---

## Slide types

How a type flows from `shared/slide-types/` into the editor, presenter, follow-along and exports, and the checklist for adding one, are in **`docs/reference/slide-type-pipeline.md`**. Read it before adding or moving a type. The registry key is internal; the reverse-DNS id is the only published spelling, folded through `resolveSlideTypeName()` / `canonicalSlideType()` in `registry.js` and re-derived nowhere else.

---

## Practical “LLM guardrails” (what to do / not do)

- **Do**: add small modules where the codebase already expects them (`shared/slide-types/types`, `client/views/*`, `client/lib/*`, `server/routes/*`, `server/storage/*`), and reuse shared helpers instead of duplicating validation/escaping/URL logic.
- **Do**: keep i18n in mind. Prose is detected by field type (`string`, `markdown`, `csv`) through `shared/slide-types/text-fields.js`, and for a content key no type declares, by the stored value. Ask that module, never a predicate of your own.
- **Do**: test storage/identity/auth without a live database via the in-memory Kysely double (`tests/helpers/fake-db.js` + `__setTestDb()`); see `docs/developer/dev-setup.md` → Testing storage behaviour without PostgreSQL.
- **Don’t**: let a core test read the fork root of the checkout: use a core-only reader (`readCoreThemeSeeds()`) or its own fixture root (`docs/reference/fork-setup.md` § _After the merge, run the suite_).
- **Don’t**: paste large blocks of CSS into JS templates, or special-case new behaviour in many files; create one reusable module and call it.

---

## Frontend patterns (use these, don't invent parallels)

- **DOM**: `h()` from `client/lib/dom/index.js`, no raw `document.createElement`.
- **Strings**: `t(key, fallback)` from `client/lib/ui-i18n.js` for all user-facing copy; translations in `client/i18n/<locale>/<component>.json`.
- **Feedback**: the kind of event decides the carrier (`docs/reference/feedback-surfaces.md`): `toast` (`client/lib/dom/toast.js`) for a passing message, `createInlineError()` (`client/lib/dom/inline-error.js`) for a refusal of the form on screen. No `alert()`, no hand-rolled `*-error` class.
- **Confirmations and modals**: `confirmModal` / `createTextInput` and the other helpers in `client/lib/dom/modal.js` (focus trap and aria wiring come free). No native `confirm()`/`prompt()`.
- **URL state**: `client/lib/state/router.js` owns the URL: `queryParam()`, `setQueryParams()`, `urlWithQuery()`, `currentUrl()`. No `new URL(location.href)` or `location.search` anywhere else.
- **CSS**: reuse `.editor-card`, `.field-label`, `.help`, `.btn`/`.btn-primary`/`.btn-danger`, `.row`/`.stack`, `.is-between` before adding classes. JSDoc on exports; match a neighbouring feature (e.g. `client/views/settings/api-keys/` for a settings panel).

## Verifying work

- `npm test` runs the node test suite.
- `npm run start` serves on http://localhost:4177 (config in `.env`; `AUTH_DEV_BYPASS=true` gives auto-login in dev).
- For UI changes, actually drive the flow in a browser before calling it done.
