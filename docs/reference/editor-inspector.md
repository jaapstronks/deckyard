# Editor inspector & editing surfaces

How the editor's editing surfaces are organized since the wysiwyg-first
editor-UI overhaul (shipped 2026-07-16): what lives where, the parity
invariant that keeps it safe to maintain, and the per-type coverage table
the keeps-model generates.

## The three surfaces

Every field and every operation on a slide has a working home in at least
one of three surfaces:

1. **The slide canvas (wysiwyg)** - the primary editing surface. In-place
   text editing, ghost chips for empty optional fields, add/remove/reorder
   of repeatable items (two-level for text-blocks rows/blocks), and direct
   manipulation of images: a draggable focal point, a single click that
   selects a filled image (solid ring + a toolbar below it with Replace and
   Settings), double-click to replace it directly, and a desktop file-drop
   onto any image. Empty slots keep a "+ Add image" affordance (they have
   nothing to occlude). Everything
   _settable_ on an image (replace, alt, fit, focus grid, per-item metadata)
   lives in the inspector's "This image" tab, not on the image - see the
   editing-surface principle in `docs/reference/editing-surfaces.md`. Descriptor
   registry: `client/views/editor/inline-edit/descriptors.js` (custom types
   declare an `inline` descriptor on the type definition, see
   `docs/developer/slide-types.md`).
2. **The "Edit all text" bulk modal** (`client/views/editor/bulk-edit-modal.js`) -
   the non-wysiwyg mode: all content fields in one list on the left, a live
   contain-scaled preview on the right, ‹ x/N › navigation across the deck.
   It mounts the _existing_ form field renderers on the `bulk` surface
   (no chrome, no Background/Accessibility; the surface table is
   `client/views/editor/editor-form/surfaces.js`), so items add/remove/reorder,
   markdown editors and validation are parity-safe **by construction** - it
   renders every non-Background/non-a11y field a type has. The slide-library
   editor mounts the same form on the `library` surface (all fields plus
   Background and Accessibility, none of the deck tools) through
   `client/views/editor/single-slide-editor.js`; see
   `docs/reference/deck-creation-and-reuse.md` § _Changing a library item_.
3. **The inspector** - a slim settings rail on the right. Background,
   Accessibility, and per-type settings/design fields (enums, icon pickers,
   URLs-as-config, focus points, chart config). No content text fields.

### The parity invariant (maintenance rule)

**A field may only be removed from the inspector when the wysiwyg or the
bulk modal demonstrably covers it - shipped and verified, never "because
it's coming".**

**Tightened 2026-07-21** (editing-surfaces decision, plan §6b corollary):
the bulk modal only counts as coverage for **content text**. For
**settings, config and metadata** - anything the user cannot point at on
the canvas: URLs, IDs, config texts, alt text, background images - the
bulk modal is never a sufficient home; those must render in the inspector.
Trigger: the video-slide's `source` had ended up bulk-only (fixed in
PR #191); the re-audit that followed restored every field in the same
class, and the generated table below is now what shows whether the
invariant still holds.

Conversely, double coverage is harmless: enums deliberately
render in the bulk modal too (it mounts the whole content half by
construction; filtering them out would complicate the
parity-by-construction argument, and the one-list job benefits from having
layout context next to text).

**Exception - the structural `layout` enum:** the toolbar "Layout" chip is
its canonical control, so the inspector no longer renders it for
`image-text` (or the `content` slide, where the same field is relabelled
"Text columns" because it only toggles 1/2 text columns there). The chip
covers it on the canvas; the bulk modal keeps the enum (no chip there), so
the parity invariant still holds.

For text-blocks, each row has an optional heading above its blocks, including the first row. The form follows that order: row heading and colour, blocks, then the arrow to the next row. Up and down describe the direction of that same between-row arrow; the final row has no outgoing arrow control. An empty row heading can be added directly on the canvas. The slide’s bottom subheading follows the rows in the form as well.

## The inspector rail

The editor is a 3-column grid, slides | canvas | inspector
(`client/styles/app/shell/20-editor-layout.css`). The inspector column
sits on the **right**, has a drag-resizable width on its left edge
(`client/views/editor/inspector-resize.js`, `--inspector-width`, min 320px,
default 340px), and is a **toggleable rail with swappable panes**
(`client/views/editor/inspector-panes.js`):

- Exactly one pane is active at a time. Two panes are registered:
  **settings** and **comments** (the deck-level comment threads, incl.
  jump-to-slide and highlight-from-marker via `data-comment-id`) —
  `editor-controller.js`, `registerPane`.
- The rail is driven by the **pane switcher**: a labeled tab group
  ([Inspector | Comments], `client/views/editor/pane-tabs.js`) at the far
  right of the topbar, in its own visual zone exactly above the rail. It is
  always visible - also with the rail closed - which is what makes the rail
  findable.
- **Pressed-state semantics**: `aria-pressed` on a tab means "rail open on
  MY pane", so a pane switch flips one tab off and the other on. Clicking
  the active pane's own tab dismisses the rail.
- **The pane's × dismisses the whole rail** (same as the tabs; hiding just
  the pane would leave an open empty rail). A dismissed rail gives the
  canvas the space (`is-inspector-collapsed`; the panel leaves the grid
  entirely).
- The unseen-comments badge sits on the Comments tab, so it is visible
  while the rail is closed.
- **Notes are not a pane**: presenter notes used to be a third pane, but
  they are not position-bound the way comments are, so they moved to a
  collapsible **strip under the slide preview**
  (`client/views/editor/notes-strip.js`, Keynote/PowerPoint convention),
  which also fills the otherwise-empty space beneath the 16:9 stage. The
  textarea keeps its collab seams (`data-collab-field-key="notes"` for
  presence, the same element reference for the live-edits binder) and the
  "Notes (QR)" companion flow sits in the strip header; the strip is
  persistent DOM, so those bindings survive rerenders.
- Lock/read-only gating is **not** the pane host's job: every editing
  surface consumes the state-driven `getSlideLockKind` seam itself (see
  `editor-controller.js`); slide locks are also enforced server-side
  (`enforceSlideWritePolicy`).

## The slide toolbar and the topbar zones

Everything scoped to the **current slide** lives with the slide, in a
toolbar in the canvas header (mount points filled by `rerenderEditor` on
every slide change): the type chip (+ retired/custom badges), "All text"
(the bulk modal), the Comment pin, the author lock, the "…" slide-actions
menu (Fill / Save to library / Convert / AI Convert / Duplicate / Delete)
and the zoom button. The inspector pane itself has **no header row**: the
"INSPECTOR" title duplicated the already-active Inspector pane tab, so the
row was dropped (declutter 2026-07-26) and only its collapse × survives, in
a zero-height slot (`.editor-form-close-slot`) that floats it over the first
field's label band. It is appended _after_ the element tab bar so it cannot
cover the "Slide" tab, and it is always visible — hover-only would strand
touch users, and the × has to sit inside the surface it dismisses.

The topbar holds only **deck-level** chrome, in zones: identity (back,
title, save status, presence) - deck editing (undo/redo, language) - deck
actions (Export, Share, deck grid, Present as the primary CTA with a
caret menu holding Companion) - utilities (user menu, ⋯ with AI analysis,
Translate, Versions, Settings, Keyboard shortcuts) - and, far right past
a separator, the pane switcher. At narrow widths the bar sheds
progressively (title shrinks; deck grid mirrors into ⋯ at ≤1024; undo/
redo ≤820; avatar ≤600) so the pane switcher never falls off-screen.

## What the settings pane renders (the keeps-model)

The pane renders Background, Accessibility, and per type only the keys in that
type's **keep-list**, declared as `inspectorKeeps` in
`shared/slide-types/types/<name>/inline-edit.js` — next to the on-canvas
descriptor it is the counterpart of, since a field is kept in the inspector
precisely because the canvas does not cover it. The keep-lists are the
**source** of the coverage audit table below, not its mirror: change a
declaration, run `node scripts/generate-slide-type-docs.js`, and the table
follows.

`client/views/editor/editor-form/inspector-form.js` resolves them through
`getInspectorKeepKeys()` and re-exports the whole set as `INSPECTOR_KEEPS` for
the companion matrix; the map itself comes from the generated aggregator
`shared/slide-types/inline-edit.js`.

- **A fork type declares its own**: `inspectorKeeps` is read off the
  definition first and travels on `GET /api/slide-types`, so a type in
  `custom/slide-types/` narrows its own settings pane the same way it declares
  `inline` or `schematic`. See `docs/reference/slide-type-directory.md`.
- **Unknown (custom/fork) types fall back conservatively**: a type neither side
  narrows keeps every schema field _except_ the proven-wysiwyg-covered keys
  (`getInlineFormTextKeys`, fed by the descriptor's `formText`). Dropping more
  would risk orphaning a field the fork has no other surface for. An empty
  keep-list (`[]`) is a real answer and is not the same as no keep-list.
- Widgets a flat keeps-list can't express (chart data editor, focus
  pickers, icon-card-grid icon+link, per-column image settings) render via
  `renderInspectorExtrasByType` in the same module. Bulky widget blocks
  ("Card icons & links", "Column images & blocks", the image-slide
  animation settings) render as **collapsible groups, default closed**, so
  the pane leads with the at-a-glance settings (layout/variant enums).

### Background: split by frequency, not by topic

`client/views/editor/editor-form/background-section.js` owns every
slide-wide background key and hands back **two** surfaces, in this rail
order: per-type settings → **background colour** (a plain, always-visible
field) → **▸ Background image** (collapsed) → **▸ Accessibility** → AI refine.

Until 2026-07-26 both halves lived in one "Background" `<details>`. That
bundle forced a bad trade: the colour picker is a primary control, so the
section had to default open, and the image tail came with it. Measured on a
title slide it was 1187 px of a ~1310 px rail, pushing Accessibility a screen
and a half down; after the split the same rail is 376 px and does not scroll.

The split runs along how often you reach for something, not along
"background yes/no":

- **Colour** (`background`, `bgCustomColor`) — frequent, one click, so it is
  a flat field among the type's own settings.
- **Image** (`slideBgImage`, `slideBgFit`, `slideBgFocusX/Y`,
  `slideBgOverlay`, `slideBgText`, `slideLogo`) — rare, and once an image is
  set it grows a tail of crop/fit/overlay/text controls. Collapsed, sticky
  preference `editor.bgImageSection.open`, **default closed** (a deliberately
  new storage key — the old one carried the opposite default).

Two consequences worth keeping:

- **The summary carries the state instead of force-opening.** A set
  background shows as a thumbnail in the summary
  (`.editor-bg-summary-thumb`), an unset one as a quiet "none" chip. That
  satisfies the never-hide-an-active-setting rule below at one row's cost
  rather than the whole panel's height.
- **Images inside the collapsed body are genuinely deferred.**
  `loading="lazy"` is not enough: it defers on viewport proximity, and an
  image in a closed `<details>` is display:none rather than far away, so the
  browser fetches it anyway (measured — all four theme presets pulled their
  full-size originals for a panel nobody opened). `deferImagesUntilOpen`
  parks the URL in `data-deferred-src` and restores it on first open.

### Collapsible vs flat — the rule

A section is **flat** (always visible) by default: the at-a-glance per-type
settings (enum/variant controls) and the selection element tabs are the common
path and stay in view. A section is **collapsible** only when it is (a) bulky
(the widget blocks above), (b) read-only / rarely opened (AI type reasoning),
or (c) an **override that is usually left at its default** (Background image,
Accessibility). The consistency rule for case (c): **an active setting is
never hidden**, and its state is legible without opening the drawer. Two ways
to honour that, and the choice is a size question: force-open when the
contents are small (Accessibility), or keep it closed and put the state in the
summary when opening would cost most of the rail (Background image's
thumbnail). Either way the summary carries a **filled indicator**.

**Accessibility status chip.** `a11yTitle`/`a11ySummary` are _overrides_, not
the primary mechanism: export and present announce a slide by its own heading
and only fall back to `a11yTitle` when set (`server/export/html.js`
`slideA11yLabel`). So an empty section is not "undescribed", and the summary
reflects the honest state instead of nagging — `auto (from the heading)` when
the slide renders a heading (neutral), `custom description ✓` when an override
is set (force-opens), and `no heading — add a title ⚠` only for the slides that
actually announce as bare "Slide N of M" (types that render no heading: payoff,
follow-invite, quote, image without a title). The heading proxy
mirrors what export reads (`readHeadingFromSlideEl` = the first non-empty
`h1/h2/h3`): the fields `title`, `question` (poll/likert/likert-slider) and
`leftTitle`/`rightTitle` (comparison). A `content.title`-only proxy would
falsely nudge poll/likert, which render their heading from `question` and have
no `title` field at all.

### Selection-aware tabs (`[This element | Slide]`)

Selecting a canvas element grows the pane a **tab bar**; with nothing selected
there is no tab bar - just the slide form (identical to the pre-tab pane).

- **Selection state** lives in the controller (`selectedElement =
{kind:'image'|'card', idx} | {kind:'text', fieldKey} | null`), cleared on
  slide change. Canvas interactions set it: a single click on a filled image →
  `{image, idx}`; editing a card's text or clicking its icon → `{card, idx}`;
  editing a stylable text field (plain or markdown) → `{text, fieldKey}`; a
  click on an empty area of the slide, or Escape outside an edit, clears it.
  Double-clicking a filled image, or clicking an empty slot, opens the image
  picker directly (replace / add) rather than selecting.
- **The canvas mirrors it** (`syncSelection()` in `inline-editor.js`, run on
  every selection change and at the end of every decoration pass): the
  selected image gets a solid ring and a toolbar below it (Replace opens the
  picker, Settings calls `onOpenElementSettings({image, idx})`, the single
  doorway to everything settable); the selected text field gets the same solid
  ring (`.ie-ol-outline.is-selected`). Because the ring is drawn from the
  controller state rather than from focus, it survives the edit's blur and the
  preview remount a sidebar change (alignment, size) triggers - the user can
  see which field the "This text" tab is acting on.
- **Rendering** (`editor-form/index.js`): when the selection applies to the slide
  (`elementAppliesToSlide`), per-element widgets render into `elementForm`
  ("This element" tab) and the rest into `form` ("Slide" tab). The active tab
  persists across rerenders and resets to the element on a fresh selection.
  `renderInspectorExtrasByType` routes each type's controls into `elementForm`:
  most image types use the **shared image-element card**
  (`editor-form/image-element-card.js`: replace/delete, alt, fit where the type
  has one, the 3x3 focus grid as the precise fallback to the canvas drag, and
  per-item metadata like a LinkedIn URL); image-set keeps its own per-image
  manager (Images section) plus role + layout; icon-card-grid → just the
  selected card's icon + link. image-text has no entry of its own: since D100 it
  carries one flat image, which the shared card covers in full.
- **Scope:** every image type carries a "This image" tab - image-slide,
  image-text, image-set, gallery, team-cards, content-columns (per selected
  column), logo-wall, quote portraits - plus icon-cards. The shared card is
  driven by the type's inline descriptor (media/focus/fit), so it writes the
  same focusX/Y keys the canvas focal-point drag writes: one value, two
  representations.
- **Who offers what is declared, not switched.** A type says which sub-element
  kinds it offers, and how many, as `elementTab` in its own
  `shared/slide-types/types/<name>/inline-edit.js`, beside `inspectorKeeps`.
  Three shapes cover every case: `{ list: 'images' }` (one tab per item of that
  collection), `{ range: [1, 3] }` (a fixed index window - quote's author
  portraits, and image-set's `[0, 2]`), `{ any: true }` (every index, for a
  type whose ceiling is not knowable up front - no core type declares it, and
  it is kept for forks and custom types). Resolve it through
  `slideTypeElementTab()` /
  `elementTabOffersIndex()` in `shared/slide-types/inline-edit-companions.js`;
  it travels on `GET /api/slide-types`, so a fork type is heard too. A type
  that declares nothing offers no element tab, which is the answer for most.
  Text selection is not declared at all: any named text field is stylable.

The element tab surfaces the controls directly; the old
`data-inspector-section="image"` addressing markers are gone (zero consumers).

### "This text" tab (block-level text styling)

A click on a text field selects `{kind:'text', fieldKey}` (a card's text still
selects the card; chart-data/csv selects nothing), which opens the **"This
text"** element tab (`text-element-card.js`). It shows the style controls the
slide type **offers** for that field - alignment, a 3-step size (S/M/L) - and
nothing else: a field without an offer gets one sentence, "This text follows
the slide's layout". A field whose siblings share the offer (array items, a
declared set) is styled as one, under a heading such as "All "Quote" (3)".
There is no per-field colour (D221).

The offer model, the `content.textStyles` storage keys, the refusals on the
write path and which core fields offer what are normative in
**[`text-styles.md`](text-styles.md)**.

## Per-type coverage audit

**Generated, not audited by hand.** The table below is derived from the
declarations each type already carries - its `fields[]` schema, its inline-edit
descriptor, its `inspectorKeeps` list, and its `layoutVariants`/`fieldGroups` -
by `scripts/generate-slide-type-docs.js`. `tests/slide-type-docs.test.js` fails
when the committed table and the registry disagree, so change a declaration and
regenerate; do not edit the rows.

It replaces a table hand-written during the 2026-07-16 audit and re-audited on
2026-07-21, which had drifted by the time it was regenerated: it still gave
card-stack a `cardCount` keep and image-text `imageFit`/`focusX/Y` keeps long
after those left the keep-lists, listed four per-column keeps for
content-columns where only `columnCount` remains, and still called the title
slide's `meta` field "byline, attribution". The _rationale_ for a keep-list is
deliberately not restated here - it lives as JSDoc beside the declaration in
`shared/slide-types/types/<name>/inline-edit.js`, which is what someone
changing the list reads.

Column semantics:

- **Canvas (wysiwyg)**: the descriptor's `formText` - the keys whose editing
  is _fully_ covered on the slide surface. A field the canvas edits only
  partly (an icon picker, a KPI delta) is deliberately absent, so this column
  is a coverage claim rather than a list of what is clickable.
- **Bulk modal (only home)**: the fields that _rely_ on the "Edit all text"
  modal - surfaced by the schema and claimed by nothing else, measured down to
  the **item field** (`rows.arrow`, `metrics.note`). Top-level claimants, each
  from a declaration: `formText`, the keep-list, the descriptor's element knobs
  (`media` in flat mode, `focus`, `fit`, `bleed` - the ImageRef axes the "This
  image" card renders), the **Layout chip** (every key a `layoutVariants`
  entry writes, plus a field group's `alignKey`), and a collection the canvas
  adds to and removes from (the `cards` list, a list-mode `media` list). An
  item field is homed when the canvas edits it (a `data-inline-field` or
  `data-inline-icon` the type's renderer emits, read off a render with every
  item field filled), when a declaration claims it (`itemGhosts`, a nested
  level's ghosts, the list-mode `media` keys and `extraFields`, a `card`
  element tab's `fields` - the "This card" tab), or when its whole list is an
  inspector keep. **Any entry is a parity violation** (see the invariant
  above); the generated column is asserted empty by
  `tests/slide-type-docs.test.js` (B450). The derivation is
  `bulkOnlyFields()` in `shared/slide-types/field-homes.js`; the definition
  validator asks it about a fork type's own `inline`, `inspectorKeeps` and
  `elementTab` and logs a boot **warning** for every field it finds, not a
  refusal (B600). A fork type without `inspectorKeeps` keeps every field in
  the inspector, so it never warns.
- **Inspector keeps**: the `inspectorKeeps` declaration - the settings/design
  fields the rail retains (enums, icons, URLs-as-config, chart config). An
  empty list is a real answer: the canvas covers everything.
- **Text style offer**: what the "This text" tab offers per field and at
  which scope (`textStyle`, `itemTextStyle`, `textStyleSets`, read through
  `textStyleOffers()`); a dash means every text field of the type follows the
  layout. What each offer promises and how the render guard proves it:
  [`text-styles.md`](text-styles.md).

One limit worth knowing: the per-type widgets in `renderInspectorExtrasByType`
(the image-set collection manager, the icon-card all-cards overview, the
list-slide text-size note) route imperatively rather than through a
declaration, so the derivation cannot count what they render. Item settings
therefore go through the `card` element tab's `fields` (a declaration the
column reads) rather than a new widget.

Not repeated per row, because they are the same for all
<!--gen:slide-type-count-->34<!--/gen:slide-type-count--> types: `slideBgImage`,

`slideBgFit`, `slideBgFocusX/Y`, `slideBgOverlay`, `slideBgText`, `slideLogo`
(Background image section), `a11yTitle`/`a11ySummary` (Accessibility) and the
per-type `background`/`bgCustomColor` colour field - all **inspector**
surfaces. `hidden` schema fields are omitted too: they are carried data, and
`editor-form/index.js` does not render them.
Numbered legacy aliases are condensed to their family (`col{n}Block{m}Body`),
and an inactive alias collection (`steps`, `stages`) follows its array field
rather than getting a home of its own.

<!--gen:slide-type-coverage-->

| Type                   | Canvas (wysiwyg)                                                                                         | Bulk modal (only home) | Inspector keeps                                                                                                             | Text style offer                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `title-slide`          | `title`, `subheading`, `meta`                                                                            | –                      | `logoCorner`                                                                                                                | `title`: size; `subheading`: size         |
| `chapter-title-slide`  | `title`, `subheading`                                                                                    | –                      | `layout`                                                                                                                    | `title`: size                             |
| `content-slide`        | `title`, `subheading`, `body`                                                                            | –                      | `layout`, `density`, `actions`, `asideVariant`, `asideText`                                                                 | `title`: align, size; `body`: align, size |
| `callout-slide`        | `label`, `body`, `source`                                                                                | –                      | `variant`                                                                                                                   | `body`: align, size                       |
| `table-slide`          | `title`, `caption`                                                                                       | –                      | `headerRow`, `tableStyle`, `animateByCell`, `cornerCell`                                                                    | –                                         |
| `list-slide`           | `title`, `subheading`, `items`                                                                           | –                      | `variant`, `layout`, `density`, `asideVariant`, `asideText`                                                                 | –                                         |
| `kpi-metrics-slide`    | `title`, `subheading`, `bottomSubheading`, `metrics`                                                     | –                      | `accent`, `countUp`                                                                                                         | –                                         |
| `image-text-slide`     | `title`, `caption`, `body`                                                                               | –                      | `imageRole`, `density`, `imageSide`, `imageWidth`, `imageBackground`, `actions`, `asideVariant`, `asideText`                | `body`: align, size                       |
| `image-set-slide`      | `title`, `caption`, `body`                                                                               | –                      | `imageRole`, `density`, `textColumns`, `imageSide`, `imageWidth`, `imageBackground`, `actions`, `asideVariant`, `asideText` | `body`: align, size                       |
| `video-slide`          | `title`                                                                                                  | –                      | `source`, `transcript`, `autoplay`, `bunnyLibraryId`, `watchUrl`                                                            | –                                         |
| `team-cards-slide`     | `title`, `subheading`, `bottomSubheading`, `subheading2`                                                 | –                      | `textPosition`, `imageShape`, `imageAspect`, `showPhotoFrame`, `columnSplit`                                                | –                                         |
| `logo-wall-slide`      | `title`, `subheading`                                                                                    | –                      | –                                                                                                                           | –                                         |
| `icon-card-grid-slide` | `title`, `subheading`, `bottomSubheading`                                                                | –                      | `layout`                                                                                                                    | –                                         |
| `payoff-slide`         | –                                                                                                        | –                      | –                                                                                                                           | –                                         |
| `quote-slide`          | –                                                                                                        | –                      | –                                                                                                                           | `quotes[].quote`: size (every item)       |
| `image-slide`          | `title`, `subheading`, `bottomSubheading`, `caption`                                                     | –                      | `imageRole`, `zoomSteps`, `zoomLevel`, `zoomPositions`                                                                      | –                                         |
| `embed-slide`          | `title`                                                                                                  | –                      | `embedUrl`, `aspectRatio`, `sandbox`                                                                                        | –                                         |
| `countdown-slide`      | `title`                                                                                                  | –                      | `durationMinutes`, `durationSeconds`, `autoStart`, `flashOnZero`, `soundOnZero`, `zeroText`                                 | –                                         |
| `poll-slide`           | `question`, `options`                                                                                    | –                      | `onClose`, `onCloseTarget`                                                                                                  | –                                         |
| `likert-slide`         | `question`, `options`                                                                                    | –                      | `onClose`, `onCloseTarget`                                                                                                  | –                                         |
| `likert-slider-slide`  | `question`, `minLabel`, `maxLabel`                                                                       | –                      | –                                                                                                                           | –                                         |
| `feedback-slide`       | `question`                                                                                               | –                      | `placeholder`                                                                                                               | –                                         |
| `follow-invite-slide`  | –                                                                                                        | –                      | –                                                                                                                           | –                                         |
| `chart-slide`          | `title`, `subheading`, `bottomSubheading`                                                                | –                      | `chartType`, `data`, `showLegend`, `showValues`, `pieLabelMode`, `xLabel`, `yLabel`, `series{n}Label`                       | –                                         |
| `text-blocks-slide`    | `title`, `subheading`, `bottomSubheading`                                                                | –                      | –                                                                                                                           | –                                         |
| `comparison-slide`     | `title`, `subheading`, `bottomSubheading`, `leftTitle`, `leftBody`, `rightTitle`, `rightBody`, `verdict` | –                      | `variant`                                                                                                                   | –                                         |
| `process-slide`        | `title`, `subheading`, `bottomSubheading`, `items`                                                       | –                      | `direction`                                                                                                                 | –                                         |
| `timeline-slide`       | `title`, `subheading`, `bottomSubheading`, `items`                                                       | –                      | –                                                                                                                           | –                                         |
| `matrix-slide`         | `title`, `subheading`, `bottomSubheading`, `cells`                                                       | –                      | `xAxis`, `yAxis`                                                                                                            | –                                         |
| `funnel-slide`         | `title`, `subheading`, `bottomSubheading`, `items`                                                       | –                      | –                                                                                                                           | –                                         |
| `pyramid-slide`        | `title`, `subheading`, `bottomSubheading`, `levels`                                                      | –                      | –                                                                                                                           | –                                         |
| `cycle-slide`          | `title`, `subheading`, `bottomSubheading`, `centerLabel`, `items`                                        | –                      | –                                                                                                                           | –                                         |
| `gallery-slide`        | `title`, `subheading`, `bottomSubheading`                                                                | –                      | `layout`                                                                                                                    | –                                         |
| `end-slide`            | `title`, `body`, `contactName`, `contactEmail`, `contactPhone`                                           | –                      | `contactUrl`, `social{n}Label`, `social{n}Url`                                                                              | –                                         |

<!--/gen:slide-type-coverage-->

Two shorthands the keeps-model JSDoc in `inspector-form.js` still refers to,
both in the safe direction:

- table `colCount` is a derived mirror managed by its editor and was never
  rendered as a form control; the inspector does not resurrect it (its ops
  live in the table editor). team-cards' `cardCount` and logo-wall's
  `logoCount` were the same kind of deviation until the schema v7 -> v8 fold
  removed both keys outright — card count is now the array's own length.
- gallery and icon-card-grid keep their `layout` enum (enums are inspector
  material by definition); icon-card-grid's card count is driven by
  add/remove, not a control.

Known residue (fields that keep a form-only or dedicated-surface home,
deliberately): logo-wall add/remove logos (form), chart data (dedicated
markdown modal), table-modal slide-view entry points (open follow-up).

## Responsive model

One converged model around a **1100px breakpoint**
(`20-editor-layout.css`):

- **>1100px (desktop)**: the 3-column grid above. The inspector width
  handle lives here.
- **≤1100px**: 2 columns - slides | canvas - with the inspector as a
  **full-width row under the canvas** (grid-template-areas; row
  `minmax(200px, 38vh)`, 42vh at ≤820px). Not an overlay: the rail-toggle
  machinery keeps working unchanged (dismissed = full-height canvas) and
  nothing floats over the wysiwyg surface. The inspector resize handle is
  hidden (the width is the full column).
- **821-1024px**: additionally swaps the slides column for the
  auto-collapse rail.
- **≤820px**: drops the slides column entirely; slides live in a drawer
  (`client/views/editor/responsive-drawers.js`, which only manages the
  slides drawer).

The canvas is the primary editing surface at every width.
