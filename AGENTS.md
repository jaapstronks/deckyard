## AGENTS README (LLM + human maintainers)

Deckyard is **simple, dependency-light and modular**: plain Node.js + vanilla ESM on server and client, **no bundler**, strict **separation of concerns**. Optimize for **maintainability, extendability and DRY**; don't “just patch it in place”. When in doubt, copy the _structure_ of an existing feature (not its text or styles).

---

## Repo architecture (high-level)

- **`shared/`**: shared logic used by both server + client.
  - **Slide types are the canonical source of truth** (schema/fields/defaults/HTML rendering).
  - `shared/markdown.js`: safe markdown subset used by slide types.
- **`client/`**: browser UI (no build step).
  - `client/views/`: features (screens and route-less feature folders); `client/lib/`: the layer that owns no feature. See _Client layers_ below.
  - `client/styles/`: CSS split into app chrome vs slide styling; themes are CSS variables.
- **`server/`**: Node server; persistence lives in Postgres behind `server/storage/`.
  - `server/routes/`: HTTP handlers (API + static).
  - `server/storage/`: facades over the database adapter plus uploads on disk; every function takes a `StorageScope` first (`docs/reference/storage-scope.md`).
  - `server/utils/`: exports (HTML/PDF/PNG/PPTX/print), rendering helpers, openai helpers, etc.
- **`themes/`**: theme JSON files resolved at runtime into CSS variables (don’t brand the app chrome).
- **`assets/`**: fonts/images used by slides and UI.

---

## The project’s “non-negotiables” (conventions)

- **Single source of truth for slide types**
  - Slide types live in `shared/slide-types/types/*.js` and are registered in `shared/slide-types/registry.js`.
  - Both client and server consume slide types through `shared/slide-types.js`.
  - The editor fetches slide type metadata from the server (`GET /api/slide-types`) to stay in sync.

- **No bundler; keep it readable**
  - Small modules in `client/lib/*`, `client/views/**`, `server/utils/**`, `server/storage/**`; no new dependency without a strong reason.

- **Formatting is Prettier's job, not a review topic**
  - Prettier on its defaults plus `singleQuote: true`: `npm run format` writes,
    `npm run format:check` gates in CI next to `npm run lint`. Don't hand-format,
    don't argue style; a `// prettier-ignore` needs a reason. Generators, the
    blame-ignore commit (`git config blame.ignoreRevsFile .git-blame-ignore-revs`
    once per clone): `docs/developer/linting.md` § Formatting.

- **Optional dependencies match how the code loads them**
  - A package reached only through a gated `await import()` lives in
    `optionalDependencies`; a statically imported one stays a hard `dependency`
    even if its feature is off. `ciiic-translation-rules` is fork-only and
    deliberately undeclared. Current set and rationale:
    `docs/reference/dynamic-imports.md` § Which packages are optional.

- **Module layout: one folder = one seam**
  - A decomposed unit is a folder `X/` whose `index.js` is the sole public
    seam; consumers import `X/index.js`, never a concern file. No eponymous
    wrapper beside the folder (`X.js` next to `X/`), no role suffix on the
    folder, and no re-export shim at a moved path (one bounded exception). In
    `server/storage/` a bare `X.js` is one module, `X/index.js` a seam.
    `tests/module-layout.test.js` enforces it, no allowlist. The full rule, the
    shim exception and the client/storage specifics:
    `docs/developer/architecture.md` § One folder = one seam.

- **Client layers: `lib/` is a layer, `views/` is a feature** (D263, D264)
  - `client/lib/` holds what owns no product feature: the DOM primitives
    (`dom/`, with `h()`), transport (`net/`, `api.js`), state and routing
    (`state/`), formatting and i18n (`format/`), the theme runtime (`theme/`),
    the slide pipeline (`slide-runtime/`, `slide-authoring/`) and a
    client-side service layer without DOM (`qa/`: model + feed + mutations,
    the views render).
  - Feature UI lives under `client/views/`: a module that **fetches a
    feature's records and renders them is a view**, however many pages use
    it. One owner → it lives inside that view; two or more → its own
    `views/<feature>/` with an `index.js` seam and no route (the shape
    `views/comments/`, `views/slide-library/` and `views/user/` have).
  - The direction is one way: **`lib/` never imports from `views/`.**
  - Feature-less shared UI has **one address: `lib/dom/`** — banners,
    empty states, a field wrapper. No `views/shared/`, no
    components or features folder, no third place.
  - `tests/client-layer-direction.test.js` pins both measurable halves at
    zero, no allowlist: no `lib/` → `views/` import, and no module under
    `lib/` outside `dom/` and `slide-runtime/` that imports both the `h()`
    seam and a fetch layer.

- **Separation of concerns**
  - **Shared slide type modules**: describe schema + defaults + **pure HTML rendering** (no DOM side effects, no fetch, no timers).
  - **Client runtime behavior**: attach behavior to rendered markup in `client/lib/*` or view controllers (and ensure cleanup).
  - **Server**: persistence and endpoints in `server/storage/*` + `server/routes/*`; export logic in `server/utils/*`.

- **Theming & styling boundaries**
  - Theme variables are scoped to `.slide` to keep **application UI** theme-independent; the `--t-*` → slide-variable layer is `client/styles/slides/00-theme.css`, loaded by `client/styles/slides.css` right after the tokens and nowhere else (D268).
  - App tokens: `--ps-*` (scale), `--app-*` (mode-bound role), `--z-*` (stack), all defined only in `client/styles/shared/ui-tokens.css`; anything else is component-local and named after its component (**`docs/reference/css-tokens.md`** § The namespace rule, `tests/app-css-tokens.test.js`).
  - Slide styling lives under `client/styles/slides/*` and is included via `client/styles/slides.css`; it reads `--slide-*` roles, never `--app-*`/`--ps-*`.
  - The presenter chrome around the deck (topbar, stage, console, progress, start curtain, present window) is the viewer layer, `client/styles/viewer/`, aggregated into `client/styles/viewer.css` and loaded by `app.css` and `export.css` before `slides.css`; not by the embed or the MCP preview (D267). Both aggregators are generated by `scripts/generate-slide-css-aggregators.js`.
  - Don’t hardcode brand colors/fonts inside slide templates. Prefer CSS vars (`--t-*` theme vars → `.slide` vars → component CSS).
  - Width-based `@media` queries sit on the shared breakpoint ladder (**`docs/reference/css-breakpoints.md`**, `tests/css-breakpoints.test.js`).

- **Avoid hardcoded copy scattered across templates**
  - UI copy lives in view-specific modules (follow-along: `createFollowCopy(lang)` in `client/views/follow/i18n.js`, resolved against the _deck_ language); slide-specific static copy in a per-slide `COPY` map keyed by language (see `follow-invite-slide`). No ad-hoc strings across unrelated modules.

- **API error envelope (internal `/api/*`)**
  - One shape: `{ ok:false, error:'<machine_code>', message?:'<human>', details?:… }`.
    `error` is a stable snake_case code (branch on it); `message` is display text.
  - Produce it through the `server/utils/http.js` helpers (`badRequest`, `notFound`,
    `rateLimited`, …) or `jsonError(res, status, code, message?)` — don't hand-roll
    `serveJson(res, status, { error })`. Client-side, read `err.code` / `err.message`
    from `api()`. See **`docs/reference/api-error-format.md`**; covered by
    `tests/api-error-envelope.test.js`. The public `/api/v1/*` surface keeps its
    own openapi-documented schema.
  - Where an error is shown is decided by its kind (see _Feedback_ under
    Frontend patterns). SSE `error` events are not the envelope: they carry
    `{ message }`, no `ok`, no `error` key (`docs/reference/api-error-format.md`
    § SSE error events).

- **Safety: HTML escaping and markdown**
  - User text into HTML goes through `escapeHtml()` (`shared/slide-types/helpers.js`)
    or `markdownToSafeHtml()` (`shared/markdown.js`); XML sinks (PPTX, SVG) use
    `escapeXml()` (`shared/xml.js`). No third copy
    (`tests/no-escape-markdown-aliases.test.js`). Data-driven markup uses `h()`,
    not an `innerHTML` template; a new `innerHTML` write must fit a safe category
    in **`docs/reference/html-escaping.md`**.

- **Lifecycle & cleanup (critical in this codebase)**
  - Any runtime side-effect (EventSource, timers, window listeners, observers)
    returns a cleanup function that runs when the slide DOM is replaced
    (`__sbCleanup` in `client/lib/slide-runtime/slide-render.js`). A client
    factory returns **`{ el, detach }`**; disposal goes through `disposeAll()`
    (`client/lib/dom/disposal.js`). Retired spellings and the rationale:
    `docs/developer/architecture.md` § Critical Convention: Lifecycle & Cleanup.

---

## Slide types

How a type flows from `shared/slide-types/` into the editor, presenter,
follow-along and exports, and the checklist for adding one (companions,
registration, the CSS class contract, runtime cleanup, public-output filtering),
are in **`docs/reference/slide-type-pipeline.md`**. Read it before adding or
moving a type. The registry key is internal; the reverse-DNS id is the only
published spelling, folded through `resolveSlideTypeName()` /
`canonicalSlideType()` in `registry.js` and re-derived nowhere else.

---

## Practical “LLM guardrails” (what to do / not do)

- **Do**: add small modules where the codebase already expects them (`shared/slide-types/types`, `client/views/*`, `client/lib/*`, `server/routes/*`, `server/storage/*`).
- **Do**: reuse shared helpers instead of duplicating validation/escaping/URL logic.
- **Do**: keep i18n in mind—prose is detected by field type (`string`, `markdown`, `csv`) through `shared/slide-types/text-fields.js`, and for a content key no type declares, by the stored value (a string is prose). Ask that module, never a predicate of your own.
- **Do**: test storage/identity/auth without a live database via the in-memory Kysely double (`tests/helpers/fake-db.js` + `__setTestDb()`); see `docs/developer/dev-setup.md` → Testing storage behaviour without PostgreSQL.
- **Don’t**: let a core test read the fork root of the checkout: use a core-only reader (`readCoreThemeSeeds()`) or its own fixture root (`docs/reference/fork-setup.md` § _After the merge, run the suite_).
- **Don’t**: paste large blocks of CSS into JS templates; keep styling in CSS files.
- **Don’t**: special-case new behavior in many files; create one reusable abstraction/module and call it.

---

## Frontend patterns (use these, don't invent parallels)

- **DOM**: `h()` from `client/lib/dom/index.js` — no raw `document.createElement`.
- **Strings**: `t(key, fallback)` from `client/lib/ui-i18n.js` for all
  user-facing copy; translations in `client/i18n/<locale>/<component>.json`.
- **Feedback**: the kind of event decides the carrier
  (`docs/reference/feedback-surfaces.md`). `toast` (`client/lib/dom/toast.js`)
  for a passing message; a refusal of the form on screen is inline via
  `createInlineError()` (`client/lib/dom/inline-error.js`), naming
  `err.details.field`, never toasted alongside. No `alert()`, no hand-rolled
  `*-error` class (`tests/feedback-surfaces-guard.test.js`).
- **Confirmations**: `confirmModal` / `createTextInput` from
  `client/lib/dom/modal.js`. No native `confirm()`/`prompt()` in new code.
- **Modals**: follow the `client/lib/dom/modal.js` helpers (focus trap and
  aria wiring come free).
- **URL state**: `client/lib/state/router.js` owns the whole current URL.
  Read query params with `queryParam(key)` / `queryString()`, write them with
  `setQueryParams({ key: value })` (`null` deletes; replaces, so no history
  entry and no re-route), build a destination with `urlWithQuery(patch)` and
  name the current page with `currentUrl()`. No `new URL(location.href)` or
  `location.search` anywhere else — a guard test pins it.
- **CSS**: reuse `.editor-card`, `.field-label`, `.help`, `.btn`/`.btn-primary`/
  `.btn-danger`, `.row`/`.stack`, `.is-between` — check existing views before
  adding classes.
- JSDoc on exports; small modules; match the structure of a neighboring
  feature (e.g. `client/views/settings/api-keys/` for a settings panel).

## Verifying work

- `npm test` runs the node test suite.
- `npm run start` serves on http://localhost:4177 (config in `.env`;
  `AUTH_DEV_BYPASS=true` gives auto-login in dev).
- For UI changes, actually drive the flow in a browser before calling it done.
