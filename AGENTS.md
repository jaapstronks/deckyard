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
  - UI copy belongs in view-specific modules (e.g. follow-along uses `client/views/follow/copy.js`).
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

- **Safety: HTML escaping and markdown**
  - Any user-provided text rendered into HTML must be escaped (`esc()` from `shared/slide-types/helpers.js`) or passed through `markdownToSafeHtml()` (`shared/markdown.js`).
  - Don’t introduce raw/unsafe HTML insertion.

- **Lifecycle & cleanup (critical in this codebase)**
  - Slides can have runtime behavior. The slide mounting pipeline (`client/lib/slide-render.js`) supports cleanup via `__sbCleanup`.
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

### Rendering

- Shared renderer: `renderSlideHtml()` in `shared/slide-types/presentation.js` calls `def.renderHtml(...)`.
- Client mounting: `client/lib/slide-render.js`:
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

- Create `shared/slide-types/types/<your-slide>.js`
- Export `default { label, fields, defaults, renderHtml }`
- Requirements:
  - `renderHtml()` must return a single root `.slide` element with a `.slide-inner` child.
  - Use `esc()` for string fields; use `markdownToSafeHtml()` for markdown fields.
  - Prefer semantic class naming: `slide-<name>` and predictable child classes.
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
- **Mount**: call the runtime from `client/lib/slide-render.js` (or the relevant view controller) and register cleanup via `__sbCleanup`.

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
- **Don’t**: paste large blocks of CSS into JS templates; keep styling in CSS files.
- **Don’t**: hardcode user-facing copy in multiple places; centralize it.
- **Don’t**: special-case new behavior in many files; create one reusable abstraction/module and call it.













