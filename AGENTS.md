## AGENTS README (LLM + human maintainers)

This repository is intentionally **simple, dependency-light, and modular**: plain Node.js + vanilla ESM on both server and client, **no bundler**, and a strong preference for **separation of concerns** so new features don’t create long-term maintenance debt.

If you are an LLM agent working on this repo: optimize for **maintainability, extendability, and DRY**, and resist the temptation to “just patch it in place”. Follow the existing organization patterns; when in doubt, copy the *structure* of an existing feature (not the text/styles).

---

## Repo architecture (high-level)

- **`shared/`**: shared logic used by both server + client.
  - **Slide types are the canonical source of truth** (schema/fields/defaults/HTML rendering).
  - `shared/markdown.js`: safe markdown subset used by slide types.
- **`client/`**: browser UI (no build step).
  - `client/views/`: “screens” (editor, presenter, follow-along, etc).
  - `client/lib/`: shared browser utilities (API, DOM helpers, slide mounting/cleanup, runtime helpers).
  - `client/styles/`: CSS split into app chrome vs slide styling; themes are CSS variables.
- **`server/`**: Node server + file-based persistence.
  - `server/routes/`: HTTP handlers (API + static).
  - `server/storage/`: JSON-on-disk persistence and uploads.
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
  - Prefer small modules in `client/lib/*`, `client/views/**`, `server/utils/**`, `server/storage/**`.
  - Avoid adding dependencies unless there is a strong reason (this project works great without them).

- **Optional dependencies match how the code loads them**
  - A package that is only reached through a gated `await import()` — behind a
    feature flag or with graceful "not installed" handling — lives in
    `optionalDependencies`, not `dependencies`, so a minimal install can omit it
    (`npm install --omit=optional`) and a failed install doesn't break the rest.
    Current set: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (S3
    media), `puppeteer-core` (Chrome exports), `pptxgenjs` (PPTX export),
    `pdf-parse` (PDF import), `bullmq` + `ioredis` (Redis job queue),
    `@hocuspocus/server` + `crossws` (live collaboration). A package that is
    *statically* imported (e.g. `openid-client`) stays a hard `dependency` even
    if its feature is off, because loading the module pulls it in regardless.
  - **`ciiic-translation-rules` is fork-only** and deliberately **not declared**
    in `package.json`: it's a private package that ships only in the CIIIC fork,
    loaded through an optional `await import()` in
    `server/utils/openai/translate.js` that falls back to empty rules when it's
    absent. Adding it to `package.json` would break `npm install` for the OSS
    repo, so it stays undeclared by design.

- **Module layout: one folder = one seam**
  - When a unit is decomposed into concern modules, it lives as a **folder `X/`
    whose `index.js` is the sole public seam** (a barrel re-exporting the public
    API); the concern modules sit inside as plain siblings. Consumers import
    `X/index.js`, never the concern files.
  - **Don't** put an eponymous wrapper file *beside* the folder (`X.js` next to
    `X/`, or a `foo-panel.js` re-export next to `foo-panel/`) — the folder's
    `index.js` already is the seam, so the wrapper is redundant indirection.
    Likewise don't suffix the folder with its role (`email-templates/`, not
    `email-templates-panel/`).
  - A module that is *not* decomposed stays a single file — it is itself a
    concern module of its parent folder (e.g. each `settings/tabs/*-tab.js` is a
    concern of `tabs/`, whose `index.js` is the barrel). A tab that grows its own
    sub-concerns becomes `tabs/<name>-tab/` with an `index.js` seam, exactly like
    `settings/` decomposes into `tabs/`.
  - Canonical example: `client/views/settings/` — every panel is a folder with an
    `index.js` barrel (`api-keys/`, `admin-users/`, `theme-editor/`, …), no
    wrappers, no role suffixes.
  - **`server/storage/` applies this literally.** A bare `X.js` is an
    *undecomposed* single-concern store (`feedback.js`, `settings.js`). The
    moment a store splits into more than one module it becomes a folder `X/`
    whose `index.js` is the facade/seam — consumers import
    `server/storage/X/index.js`, never a concern file. The DB-vs-file dispatch
    facades follow this too: the file backend is the concern module `X/file.js`
    *inside* the folder, not an `X-file.js` sibling *beside* it. So reading a
    storage import tells you the shape: `X.js` = one module; `X/index.js` = a
    seam over concern modules (`X/file.js`, `X/list.js`, …).

- **Separation of concerns**
  - **Shared slide type modules**: describe schema + defaults + **pure HTML rendering** (no DOM side effects, no fetch, no timers).
  - **Client runtime behavior**: attach behavior to rendered markup in `client/lib/*` or view controllers (and ensure cleanup).
  - **Server**: persistence and endpoints in `server/storage/*` + `server/routes/*`; export logic in `server/utils/*`.

- **Theming & styling boundaries**
  - Theme variables are scoped to `.slide` to keep **application UI** theme-independent (`client/styles/theme.css`).
  - Slide styling lives under `client/styles/slides/*` and is included via `client/styles/slides.css`.
  - Don’t hardcode brand colors/fonts inside slide templates. Prefer CSS vars (`--t-*` theme vars → `.slide` vars → component CSS).
  - Width-based `@media` queries must sit on the shared breakpoint ladder (480/640/768/1024/1280, `min-width` counterparts one pixel up, plus the ultra-wide 1400/1600/1800). See **`docs/reference/css-breakpoints.md`**; enforced by `tests/css-breakpoints.test.js`.

- **Avoid hardcoded copy scattered across templates**
  - UI copy belongs in view-specific modules (e.g. follow-along uses `client/views/follow/i18n.js`, whose `createFollowCopy(lang)` resolves `client/i18n/<locale>/follow.json` against the *deck* language).
  - Slide-specific “static” copy should be centralized in a small per-slide `COPY` map keyed by language if needed (see `follow-invite-slide`).
  - Don’t sprinkle ad-hoc strings across unrelated modules.

- **API error envelope (internal `/api/*`)**
  - One shape: `{ ok:false, error:'<machine_code>', message?:'<human>', details?:… }`.
    `error` is a stable snake_case code (branch on it); `message` is display text.
  - Produce it through the `server/utils/http.js` helpers (`badRequest`, `notFound`,
    `rateLimited`, …) or `jsonError(res, status, code, message?)` — don't hand-roll
    `serveJson(res, status, { error })`. Client-side, read `err.code` / `err.message`
    from `api()`. See **`docs/reference/api-error-format.md`**; covered by
    `tests/api-error-envelope.test.js`. The public `/api/v1/*` surface keeps its
    own openapi-documented schema.
  - **SSE `error` events are not the envelope.** They carry
    `{ message:'<human>' }` (plus endpoint-specific extras like `report`) — no
    `ok`, and no `error` key. The `event: error` line is already the
    discriminator, so `ok:false` would duplicate the routing in the payload, and
    `error` stays reserved for the machine code it means on the HTTP side rather
    than being re-used for prose. This also matches `status` events, which
    already use `message` for human text. Should a client ever need to branch on
    the cause, add `error:'<snake_case_code>'` alongside `message` — additive,
    with exactly the HTTP meaning, never a rename.

- **Safety: HTML escaping and markdown**
  - Any user-provided text rendered into HTML must be escaped (`esc()` from `shared/slide-types/helpers.js`) or passed through `markdownToSafeHtml()` (`shared/markdown.js`).
  - Don’t introduce raw/unsafe HTML insertion. For data-driven markup use `h()` (`client/lib/dom.js`) rather than an `innerHTML` template.
  - The safe categories for an existing/new `innerHTML` write, and why every current client `innerHTML` site is safe, are catalogued in **`docs/reference/html-escaping.md`** — a new write is safe only if it falls into one of them.

- **Lifecycle & cleanup (critical in this codebase)**
  - Slides can have runtime behavior. The slide mounting pipeline (`client/lib/slide-runtime/slide-render.js`) supports cleanup via `__sbCleanup`.
  - If you add any runtime side-effects (EventSource, timers, window listeners, observers), you must return a cleanup function and ensure it’s called when slide DOM is replaced.

---

## “How slide types work” (the end-to-end pipeline)

### Where slide types live

- **Registry**: `shared/slide-types/registry.js` exports `SLIDE_TYPES` mapping `type -> def`.
- **Definition**: `shared/slide-types/types/<type>.js` exports a `def`:
  - `label`: human label for the editor UI
  - `fields`: schema describing editable fields (drives editor UI + validation + translation)
  - `defaults`: default content object for new slides
  - `renderHtml(content, slide, ctx)`: returns the `.slide` markup string
- **Companions**: every type also has a `shared/slide-types/types/<type>/`
  directory holding the per-type facets other subsystems read (`authoring.js`,
  `inline-edit.js`, …). A definition is *not* complete without the companions
  its features need — a missing one fails open and silently, which is why they
  have their own map. Read
  [`docs/reference/slide-type-directory.md`](docs/reference/slide-type-directory.md)
  (layout + the aggregator-seam rule) and
  [`docs/reference/slide-type-companions.md`](docs/reference/slide-type-companions.md)
  (what each companion is and what breaks without it) before adding or moving a
  type.
- **Two shapes coexist.** The A7.1 rollout is converting definitions from the
  flat `types/<type>.js` into `types/<type>/index.js`, one type at a time, so
  both forms are live and the registry imports both. Anything that counts or
  globs type files must accept `<name>.js` **and** `<name>/index.js`; a bare
  `grep '\.js$'` over that directory counts companions as types.
- **Identity**: the registry key (`title-slide`) is what `slides[].type` stores
  and stays that forever, but the *published* id is reverse-DNS
  (`eu.deckyard.slide.title`, suffix dropped). `resolveSlideTypeName()` in
  `registry.js` is the single place that knows the spellings are one type — do
  not re-derive that mapping anywhere else. See
  [`docs/reference/deck-format.md`](docs/reference/deck-format.md).

### Rendering

- Shared renderer: `renderSlideHtml()` in `shared/slide-types/presentation.js` calls `def.renderHtml(...)`.
- Client mounting: `client/lib/slide-runtime/slide-render.js`:
  - renders HTML → element
  - applies theme vars to the slide element (scoped)
  - initializes known slide runtimes (e.g. follow-invite QR, video embeds)
  - provides cleanup via `__sbCleanup` when slides are replaced

### Editor fields + layout

- The editor pulls `fields/defaults/label` from `GET /api/slide-types` (`server/routes/api/slide-types.js`).
- Most slide forms are generated from `fields[]`.
- Some slide types have **custom form layout** modules under `client/views/editor/editor-form/slide-forms/*` and are wired in `client/views/editor/editor-form.js`.
  - Add a custom form only when the generic rendering is insufficient (grouping, custom UX, derived fields).

### Presenter stepping (“Tekst stap voor stap”)

- Step mode is DOM-driven in `client/views/presenter/step.js`.
- If you want a new slide type to be step-able, follow existing DOM conventions (preferred) instead of one-off hacks:
  - Body stepping looks for `.slide-content .body` or `.slide-image-text .copy .body`
  - Card stepping looks for known card containers
  - Chart stepping looks for `.slide-chart .chart-frag`
  - If you introduce a new stepping structure, extend `step.js` in a generic way.

### Follow-along mode + interactions

- Follow view is modular: `client/views/follow.js` composes:
  - SSE controller (`client/views/follow/sse.js`)
  - Q&A controller (`client/views/follow/qa.js`)
  - Interactions controller (`client/views/follow/interactions.js`)
  - Slide rendering uses `mountSlideInto(..., { mode: 'follow' })`
- Interaction slides typically “opt in” via predictable slide types/markup (e.g. `data-interaction="likert"`).
  - If you add a new interaction type, keep the same separation:
    - **Slide markup** in the slide type module
    - **Follow UI/runtime** in `client/views/follow/*`
    - **Server endpoints/state** in `server/routes/api/follow/*` + storage layer

### Public outputs / exports

- Exports share slide HTML rendering via `shared/slide-types.js` (server utils re-export).
- Live-only slides are stripped from public output (`server/utils/public-output.js`).
  - If you introduce another “live-only” concept, ensure exports/publishing filter it in one place (don’t duplicate filtering logic).

---

## Adding a new slide type (checklist that matches this repo)

### 1) Add the shared slide type module (canonical)

- Create `shared/slide-types/types/<your-slide>.js` (or `<your-slide>/index.js` —
  both shapes are live, see *Where slide types live*)
- Export `default { label, fields, defaults, renderHtml }`
- **Add the companions too**, in `shared/slide-types/types/<your-slide>/`. The
  checklist of which ones a type needs, and what silently degrades when one is
  missing, is [`docs/reference/slide-type-companions.md`](docs/reference/slide-type-companions.md).
  Skipping this is the single most common way a new type ships half-wired.
- Requirements:
  - `renderHtml()` must return a single root `.slide` element with a `.slide-inner` child.
  - Use `esc()` for string fields; use `markdownToSafeHtml()` for markdown fields.
  - Prefer semantic class naming: `slide-<name>` and predictable child classes.
    Modifiers use the BEM double-dash: `.slide-card--accent`, `.slide-action--primary`
    (not flat `.slide-action-primary`). The block/element stays single-dash
    (`.slide-action`), variants get `--`.
  - Keep `renderHtml()` **pure**: no DOM reads/writes, no network, no timers.

### 2) Register the type

- Add an import + entry to `shared/slide-types/registry.js`.
- This automatically enables:
  - validation (`validateSlide`)
  - default content creation (`newSlide`)
  - rendering across editor preview, presenter, follow-along, and exports
  - server-provided editor metadata (`GET /api/slide-types`)

### 3) Style it in the right CSS layer

- Add a CSS file under `client/styles/slides/` in the appropriate bundle:
  - layout/title-ish slides: `client/styles/slides/01-layout-and-title/*`
  - components/interactive/presenter helpers: `client/styles/slides/03-components/*`
- Import it from the corresponding aggregator file (`client/styles/slides/01-layout-and-title.css` or `03-components.css`).
- Use theme variables via `.slide { --... }` indirection (see `client/styles/theme.css`).
  - Don’t hardcode brand colors/fonts inside the slide CSS.
- **Don’t reach for the app-chrome tokens (`--ps-*`, `--z-*`) inside
  `client/styles/slides/**`.** `slides.css` doesn’t import `ui-tokens.css`, and
  the MCP preview bundles it alone — so the token resolves in the browser but
  silently resolves to nothing there. Details and the spacing/z-index scales:
  `docs/reference/css-tokens.md`.

### 4) Ensure the editor UX fits the patterns

- If generic field rendering is enough: you’re done.
- If you need a special layout/grouping:
  - Add a module under `client/views/editor/editor-form/slide-forms/<your-slide>.js`
  - Wire it into `client/views/editor/editor-form.js` similarly to `chart-slide` or `follow-invite-slide`
  - Do **not** create a one-off editor UI that redefines schema; the schema stays in `shared/`.

### 5) If the slide needs runtime behavior, add it cleanly

Preferred pattern:
- **Markup**: add `data-*` attributes/classes in `renderHtml()` that the runtime can target.
- **Runtime**: implement in `client/lib/<feature>.js` or a view module, returning a cleanup function.
- **Mount**: call the runtime from `client/lib/slide-runtime/slide-render.js` (or the relevant view controller) and register cleanup via `__sbCleanup`.

Avoid:
- Starting runtimes inside `renderHtml()`
- Attaching global listeners without cleanup
- Hiding complexity in “random” views

### 6) Follow-along / interactions (only if relevant)

If the slide is an audience interaction:
- Decide whether it’s:
  - **dominant interaction UI** (follow view hides slide and shows interaction card), or
  - **slide shows results while audience interacts**
- Implement consistent server endpoints under `server/routes/api/follow/*` and keep state in `server/storage/*`.
- Make sure the follow view can refresh without SSE (there’s a polling safety net).

### 7) Publishing/exports compatibility

- Verify the slide renders correctly in:
  - editor preview
  - presenter
  - follow-along (if applicable)
  - exported HTML/print/PDF/PNG/PPTX (if applicable)
- If it should **not** appear in public outputs, add a single centralized filter (see `stripLiveOnlySlidesFromPresentation()`).

---

## Practical “LLM guardrails” (what to do / not do)

- **Do**: add small modules where the codebase already expects them (`shared/slide-types/types`, `client/views/*`, `client/lib/*`, `server/routes/*`, `server/storage/*`).
- **Do**: reuse shared helpers instead of duplicating validation/escaping/URL logic.
- **Do**: keep i18n in mind—translatable fields are detected by field `type === 'string' | 'markdown'`.
- **Do**: test storage/identity/auth behaviour without a live database via the in-memory Kysely double (`tests/helpers/fake-db.js` + `__setTestDb()` from `server/db/client.js`) — it enforces UNIQUE constraints and logs every table touched so you can assert what was *not* queried. See **`docs/developer/dev-setup.md` → Testing storage behaviour without PostgreSQL**.
- **Don’t**: paste large blocks of CSS into JS templates; keep styling in CSS files.
- **Don’t**: hardcode user-facing copy in multiple places; centralize it.
- **Don’t**: special-case new behavior in many files; create one reusable abstraction/module and call it.













