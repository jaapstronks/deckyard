# Slide-type pipeline and the new-type checklist

How a slide type flows from its definition to every surface, and the checklist
for adding one. Moved out of `AGENTS.md` (B553) so a session loads it only when
it touches slide types; `AGENTS.md` § Slide types points here.

## How slide types work (the end-to-end pipeline)

### Where slide types live

- **Registry**: `shared/slide-types/registry.js` exports `SLIDE_TYPES` mapping `type -> def`.
- **Definition**: `shared/slide-types/types/<type>.js` exports a `def`:
  - `label`: human label for the editor UI
  - `fields`: schema describing editable fields (drives editor UI + validation + translation)
  - `defaults`: default content object for new slides
  - `renderHtml(content, slide, ctx)`: returns the `.slide` markup string
- **Companions**: every type also has a `shared/slide-types/types/<type>/`
  directory holding the per-type facets other subsystems read (`authoring.js`,
  `inline-edit.js`, …). A definition is _not_ complete without the companions
  its features need — a missing one fails open and silently, which is why they
  have their own map. Read
  [`docs/reference/slide-type-directory.md`](slide-type-directory.md)
  (layout + the aggregator-seam rule) and
  [`docs/reference/slide-type-companions.md`](slide-type-companions.md)
  (what each companion is and what breaks without it) before adding or moving a
  type.
- **Two shapes coexist.** The A7.1 rollout is converting definitions from the
  flat `types/<type>.js` into `types/<type>/index.js`, one type at a time, so
  both forms are live and the registry imports both. Anything that counts or
  globs type files must accept `<name>.js` **and** `<name>/index.js`; a bare
  `grep '\.js$'` over that directory counts companions as types.
- **Identity**: the registry key (`title-slide`) is the internal lookup key;
  the _published_ id is reverse-DNS (`eu.deckyard.slide.title`, suffix dropped)
  and is the format's **only** spelling. Export and the read APIs emit it via
  `canonicalSlideType()`; imports and every write path fold any spelling back to
  the key via `resolveSlideTypeName()` — both live in `registry.js` and are the
  single place that knows the legacy mapping. Do not re-derive it anywhere else,
  and never add a surface that accepts a non-canonical spelling without
  normalizing through it, nor one that emits the bare key across the boundary.
  Stored `slides[].type` still holds the bare key until the v3→v4 migration
  lands (see `docs/plans/briefs/one-spelling.md`). See
  [`docs/reference/deck-format.md`](deck-format.md) and the beta
  stance in [`docs/reference/versioning.md`](versioning.md).

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
- Some slide types have **custom form layout** modules under `client/views/editor/editor-form/slide-forms/*` and are wired in `client/views/editor/editor-form/index.js`.
  - Add a custom form only when the generic rendering is insufficient (grouping, custom UX, derived fields).

### Presenter stepping (“Tekst stap voor stap”)

- Step mode is DOM-driven in `client/views/presenter/step.js`.
- If you want a new slide type to be step-able, follow existing DOM conventions (preferred) instead of one-off hacks:
  - Body stepping looks for `.slide-content .body` or `.slide-image-text .copy .body`
  - Card stepping looks for known card containers
  - Chart stepping looks for `.slide-chart .chart-frag`
  - If you introduce a new stepping structure, extend `step.js` in a generic way.

### Follow-along mode + interactions

- Follow view is modular: `client/views/follow/index.js` composes:
  - SSE controller (`client/views/follow/sse.js`)
  - Q&A controller (`client/views/follow/qa.js`)
  - Interactions controller (`client/views/follow/interactions/index.js`)
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
  both shapes are live, see _Where slide types live_)
- Export `default { label, fields, defaults, renderHtml }`
- **Add the companions too**, in `shared/slide-types/types/<your-slide>/`. The
  checklist of which ones a type needs, and what silently degrades when one is
  missing, is [`docs/reference/slide-type-companions.md`](slide-type-companions.md).
  Skipping this is the single most common way a new type ships half-wired.
- Requirements:
  - `renderHtml()` must return a single root `.slide` element with a `.slide-inner` child.
  - Use `esc()` for string fields; use `markdownToSafeHtml()` for markdown fields.
  - Prefer semantic class naming: `slide-<name>` and predictable child classes.
    Modifiers use the BEM double-dash: `.slide-badge--danger`, `.slide-action--primary`
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
  - components/interactive helpers: `client/styles/slides/03-components/*`
  - not presenter chrome: that is the viewer layer, `client/styles/viewer/` (D267)
- Declare it in `TYPE_CSS` in `scripts/generate-slide-css-aggregators.js` and run `npm run gen:slide-css`; the aggregator files (`client/styles/slides/01-layout-and-title.css`, `03-components.css`, …) are generated, never hand-edited.
- Use theme variables via `.slide { --... }` indirection (see `client/styles/slides/00-theme.css`).
  - Don’t hardcode brand colors/fonts inside the slide CSS.
- **Don’t reach for the app-chrome tokens (`--ps-*`, `--z-*`) inside
  `client/styles/slides/**`.** `slides.css` doesn’t import `ui-tokens.css`, and
  the MCP preview bundles it alone — so the token resolves in the browser but
  silently resolves to nothing there. Details and the spacing/z-index scales:
  `docs/reference/css-tokens.md`.
- **The class names a type emits are a public contract.** Every one must resolve
  to a CSS rule (`tests/slide-type-css-contract.test.js`), and a _rename_ goes in
  the release notes under the breaking-changes heading — a fork styling its own
  slide types against core CSS has no other way to learn a name moved. This is
  the breakage that reached production in v1.8.0 with 2151 green tests behind it.
  `docs/reference/slide-type-css-contract.md`.

- If your type carries a content key that identifies **this slide instance** to
  something outside the deck (an interaction id, a cached deck id), declare it
  with `instanceKeys` so every copy path (duplicate, paste, library insert)
  re-derives it. Vocabulary: `shared/slide-types/instance-keys.js`.

### 4) Ensure the editor UX fits the patterns

- If generic field rendering is enough: you’re done.
- If you need a special layout/grouping:
  - Add a module under `client/views/editor/editor-form/slide-forms/<your-slide>.js`
  - Wire it into `client/views/editor/editor-form/index.js` similarly to `chart-slide` or `follow-invite-slide`
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
