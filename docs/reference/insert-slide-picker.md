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
- **Type picker** — `client/views/editor/slide-type-picker/`. Its
  `index.js` (`createSlideTypePicker` →
  `renderSlideTypePicker`) is the seam: it owns render orchestration and the
  mutable per-render state (view mode, preview surface, observers, the peek
  handle) and composes `data.js` (curated presets + tuning constants),
  `preferences.js` (every localStorage key), `thumbnails.js` (video/embed
  mocks + schematic filler), `peek.js` (lightbox) and `variants.js` (folded
  preset rows).
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

Three tiles do not follow the switch: Gallery, Image cards and Logo wall
(`ALWAYS_PREVIEW_TYPES` in `data.js`, the Media shelf's "Collection" row) always
render their live preview. All three draw as a grid in a schematic, so only
their content tells them apart.

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
- The Media shelf reads in two rows, "One image" (Image + text, Images + text,
  Image slide, Video, Embed) and "Collection" (Gallery, Image cards, Logo
  wall), each under a small subheading (`MEDIA_ROWS` in `data.js`). The
  subheadings are full-width items in the shelf's one grid, so collapsing,
  search and keyboard navigation treat the shelf as one; a subheading hides
  with its row during a search. A media type no row names joins "One image".

### Quick-access strips

Rendered above the categories, all local-only:

- **Pinned** — a pin affordance per tile toggles a type in
  `ps-slide-type-pins`; pinned types get a "Pinned" strip. Pin changes update
  tiles + strip incrementally (no thumbnail re-render/flash).
- **Frequently used** — `bumpUsage(type)` increments `ps-slide-type-usage` on
  insert; the top types (excluding pinned) show once there's real signal
  (`FREQUENT_MIN_TOTAL` total inserts, ≥2 distinct types), capped to one row.
- **Start here** — the empty state of Frequently used (D342). Until that strip
  has signal, the picker opens on a "Start here" shelf with eight types in a
  fixed order (`START_HERE_TYPES` in `data.js`): Title slide, Text slide, List,
  Image + text, Gallery, Chart, Table, Quote. A type the deck disallows is
  skipped. Once Frequently used shows, it takes this place: the picker never
  renders both. The tiles are plain base tiles, without a variants corner.

## Layout-variant presets

`SLIDE_TYPE_PRESETS` (keyed by type) offers meaningful layout variants that
insert pre-configured — a picker-level concern, **not** a schema change.
Curated set: callout (five kinds), image + text (left, right, 63%, corner) and
list (bullets, numbers).

**One tile per type; the variants fold (D341).** A shelf shows the base tile,
which inserts the type's default, with an always-visible corner button "N
variants" (`variants.js`, `buildVariantsToggle`). The button unfolds a row of
variant tiles inside the same shelf grid (`buildVariantRow`): a full-width grid
item placed after the last tile on the base tile's visual row
(`placeVariantRow`, measured with the row out of the flow, re-placed when the
grid resizes), so the tiles after it keep their places. One row is open at a
time; opening another closes it. The rows are built hidden up front, which is
what lets search reach a variant directly (a query that matches a variant shows
its row, open or not) and lets the keyboard nav walk into an open row in DOM
order. Shelf counts and the "34 tiles or fewer" check count only a shelf's own
tiles (`:scope > .ps-type-grid > .ps-type-card-wrap`).

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
- Only curated category grids fold presets (`buildGroup(..., expandPresets)`);
  the pinned/frequent/other strips show the base tile without a corner.

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

## The slide library is a tab

Saved slides are not offered in the Slide types tab. "Slide library" is a tab
of the same dialog (`slide-type-modal.js`), and the only way in from the
insert flow (D342).

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
- An open variant row (D341) sits in DOM order right after its base tile's
  visual row, so the arrows walk into it and out again; a folded row is hidden
  and skipped. The corner button itself is reached with Tab, like peek and pin.

This follows the **image-library grid** convention (arrow-key focus movement
among the primary card buttons, native button semantics) rather than a
roving-tabindex `listbox`/`option`: each tile also carries secondary peek/pin
buttons, which a listbox/option role would misrepresent and pull out of the tab
order. (The icon-picker uses listbox/option, but its cells have no secondary
buttons.)

## Persisted keys (localStorage)

| Key                         | Meaning                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `ps-slide-picker-view`      | thumbnail view mode (`schematic` \| `preview`; default `schematic`) |
| `ps-slide-picker-collapsed` | per-section collapsed map (`getJSON/setJSON`)                       |
| `ps-slide-type-usage`       | `{ type: insertCount }` for Frequently-used                         |
| `ps-slide-type-pins`        | pinned type keys                                                    |
| `ps-slide-picker-bg`        | forced preview surface (`'' ` = auto)                               |

## i18n

Flat dotted keys in `client/i18n/{en,nl}/editor.json`:
`editor.slideTypeGroup.*` (section titles + strips), `editor.slideTypeDesc.<type>`
(tile captions), `editor.slideTypePicker.*` (controls), and
`editor.slideTypePreset.*` (variant tile labels); the corner and the row hint
are `editor.slideTypePicker.variants` (plural) and `.variantsHint`. English fallbacks are inline
`t(key, 'English')` args, so the picker works untranslated.
