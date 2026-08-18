# Insert-slide picker

How the "Insert slide" modal's slide-type grid is built, previewed, and
navigated. This is the durable reference distilled from the completed
insert-slide-modal-overhaul work (PRs #102–#110); it describes what exists, not
change history.

## Modules

- **Modal shell** — `client/views/editor/modals/slide-type-modal.js`
  (`openSlideTypeModal`). Renders the header, the compact insert-position row,
  and the tab toggle (Slide types / Slide library / Import from file). Delegates
  each tab body to an injected renderer.
- **Type picker** — `client/views/editor/slide-type-picker/` behind the
  `slide-type-picker.js` re-export shim. `index.js` (`createSlideTypePicker` →
  `renderSlideTypePicker`) is the seam: it owns render orchestration and the
  mutable per-render state (view mode, preview surface, observers, the peek
  handle) and composes `data.js` (curated presets + tuning constants),
  `preferences.js` (every localStorage key), `thumbnails.js` (video/embed
  mocks + schematic filler), `peek.js` (lightbox) and `library-strip.js`.
- **Sample content** — `client/views/editor/slide-type-sample-content.js`
  (`getSampleContent`). Per-type example content merged onto each type's
  `defaults` for the thumbnails.
- **Keyboard nav** — `client/views/editor/slide-type-picker-keyboard.js`
  (`wireGridKeyboardNav`).

## Thumbnails: schematic (default) or live render

A segmented control (`editor.slideTypePicker.view.schematic` /
`.preview`) switches the tiles between abstract schematic diagrams and live
renders; the choice persists in `ps-slide-picker-view` and defaults to
`schematic`. The rest of this section describes the `preview` mode.

`hydrateThumb` builds a fake slide `{ type, content: sampleContentFor(type) }`
and calls `renderSlideElement(slide, { mode: 'thumb', theme })`. CSS scales the
real 1600px `.slide` down to the tile via a per-tile `--thumb-scale`
(`clientWidth / 1600`, kept in sync by a `ResizeObserver`).

Thumbnails are **lazy**: each tile starts `.is-pending` and only hydrates when
an `IntersectionObserver` (rootMargin `300px`) brings it near the viewport.
Cards in a collapsed section (grid `display:none`) or hidden by search have no
box, so they simply stay pending until shown. Both observers are recreated per
render and torn down on the next pass (`teardownObservers`).

Two types never render their real slide (they'd boot an embed SDK / live
iframe) and use static mockups instead: `video-slide` (`fillVideoThumb`, a
poster frame + play button) and `embed-slide` (`fillEmbedThumb`, a browser-chrome
mock).

## Category grouping

Category arrays live in the picker, not the registry: `basicDefs`, `mediaDefs`,
`layoutDefs`, `processDefs`, `dataDefs`, `interactionDefs`, plus auto-collected
`customDefs`. Display order is set by the `curatedGroups` array (process/timeline
sit above data by request). Rules:

- Each category is a collapsible section; open/closed state persists in
  `ps-slide-picker-collapsed`. `interaction` starts collapsed by default
  (`DEFAULT_COLLAPSED`).
- A group with a single item is folded into "Other" rather than wasting a
  section header. Leftover uncategorized types land in "Other"; `payoff-slide`
  is pinned to its tail.
- During an active search, collapsed sections are force-expanded (via
  `is-searching`) so matches stay visible.

### Quick-access strips

Rendered above the categories, both local-only:

- **Pinned** — a pin affordance per tile toggles a type in
  `ps-slide-type-pins`; pinned types get a "Pinned" strip. Pin changes update
  tiles + strip incrementally (no thumbnail re-render/flash).
- **Frequently used** — `bumpUsage(type)` increments `ps-slide-type-usage` on
  insert; the top types (excluding pinned) show once there's real signal
  (`FREQUENT_MIN_TOTAL` total inserts, ≥2 distinct types), capped to one row.

## Layout-variant presets

`SLIDE_TYPE_PRESETS` (keyed by type) surfaces meaningful layout variants as
their own tiles that insert pre-configured — a picker-level concern, **not** a
schema change. Curated set: image-text left/right, content one/two-column,
list bullets/numbers.

- A preset is `{ id, labelKey, label, content, previewContent? }`. `content` is
  the override applied on insert (threaded through `insertSlide` via a
  `contentOverrides` option, `Object.assign`ed over the type's defaults).
  `previewContent` (optional) is used **only** for the thumbnail/peek render, so
  a variant can show richer sample content than it inserts — e.g. the two-column
  content preset renders a long body so the preview actually flows into the
  second column (CSS `column-fill: auto` needs the first column to overflow),
  while the inserted slide keeps the type's real default body.
- **Signal keys off the base type.** `bumpUsage`, pins, and search all track the
  base type, so variants never fragment the frequently-used/pinned signal:
  pinning any variant pins the whole type, and the Pinned/Frequently-used strips
  render one compact base tile. A preset tile's search haystack includes the
  base label too, so a query for the type name finds every variant.
- Only curated category grids expand presets (`buildGroup(..., expandPresets)`);
  the pinned/frequent/other strips stay one base tile per type.

## Preview-background toggle

A swatch toggle on the controls row forces a surface (Auto / Lime / Mist / Dark)
onto every visible thumbnail whose type supports it; the choice persists in
`ps-slide-picker-bg`. It only offers surfaces the active theme defines with a
**distinct** token value (`--t-slide-bg-<surface>`) **and** that ≥1 insertable
type supports, and hides entirely below 2 distinct surfaces. It is also hidden
outside preview mode — schematics paint no surface — so it does not appear in
the picker's default view. `sampleContentFor`
applies the surface last (after any preset override), and `restyleHydratedThumbs`
re-renders only already-hydrated, background-capable tiles on change.

## Click-to-peek

A magnifier button (top-left of each tile, mirrors the pin) opens a lightbox
with a large render of the type on the current surface (respecting the tile's
preset), plus label/description and an Insert action. A **capture-phase** Escape
listener closes the peek without also closing the picker modal; scrim-click and
Close dismiss it; focus returns to the originating tile.

## Inline "From your library" strip

When a modal context supplies `loadLibraryStripItems` + `onSeeAllLibrary`, a
"From your library" strip loads async (never blocking the type grid) and is
prepended above the categories: up to 8 insertable, non-trashed items split
across your personal and organization shelves (favourites first). The budget is
weighted by how many slides each shelf has but guarantees at least one tile
from every non-empty shelf, so a lone personal slide is never buried under a
large organization shelf. Each tile inserts the reused slide; "See all" jumps to the
Slide library tab. Hidden entirely on empty/error, and skipped where no library
tab exists (e.g. the quick-add drawer).

## Keyboard-first flow

`wireGridKeyboardNav({ container, searchInput })` makes the grid keyboard-first
(the search box autofocuses on open):

- ArrowDown from the search box enters the grid at the first visible card.
- Arrow keys move between visible cards across every section — Left/Right in DOM
  order; Up/Down pick the nearest card in the adjacent row **by geometry**, so
  it stays correct on the responsive auto-fill grid, partial last rows, and
  section boundaries.
- ArrowUp from the top row returns focus to the search box; Home/End jump to the
  first/last visible card; Enter/Space inserts (native `<button>`).
- Visibility is an `offsetParent !== null` check, so collapsed/hidden cards are
  skipped.

This follows the **image-library grid** convention (arrow-key focus movement
among the primary card buttons, native button semantics) rather than a
roving-tabindex `listbox`/`option`: each tile also carries secondary peek/pin
buttons, which a listbox/option role would misrepresent and pull out of the tab
order. (The icon-picker uses listbox/option, but its cells have no secondary
buttons.)

## Persisted keys (localStorage)

| Key | Meaning |
| --- | --- |
| `ps-slide-picker-view` | thumbnail view mode (`schematic` \| `preview`; default `schematic`) |
| `ps-slide-picker-collapsed` | per-section collapsed map (`getJSON/setJSON`) |
| `ps-slide-type-usage` | `{ type: insertCount }` for Frequently-used |
| `ps-slide-type-pins` | pinned type keys |
| `ps-slide-picker-bg` | forced preview surface (`'' ` = auto) |

## i18n

Flat dotted keys in `client/i18n/{en,nl}/editor.json`:
`editor.slideTypeGroup.*` (section titles + strips), `editor.slideTypeDesc.<type>`
(tile captions), `editor.slideTypePicker.*` (controls), and
`editor.slideTypePreset.*` (variant tile labels). English fallbacks are inline
`t(key, 'English')` args, so the picker works untranslated.
