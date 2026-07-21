# Editor inspector & editing surfaces

How the editor's editing surfaces are organized since the wysiwyg-first
editor-UI overhaul (shipped 2026-07-16): what lives where, the parity
invariant that keeps it safe to maintain, and the per-type coverage audit
that the inspector's keeps-model mirrors.

## The three surfaces

Every field and every operation on a slide has a working home in at least
one of three surfaces:

1. **The slide canvas (wysiwyg)** - the primary editing surface. In-place
   text editing, ghost chips for empty optional fields, add/remove/reorder
   of repeatable items (two-level for text-blocks rows/blocks), and direct
   manipulation of images: a draggable focal point, and double-click to
   replace a filled image. Empty slots keep a "+ Add image" affordance (they
   have nothing to occlude) and accept a desktop file-drop. Everything
   *settable* on an image (replace, alt, fit, focus grid, per-item metadata)
   lives in the inspector's "This image" tab, not on the image - see the
   editing-surface principle in `docs/plans/editing-surfaces.md`. Descriptor
   registry: `client/views/editor/inline-edit/descriptors.js` (custom types
   declare an `inline` descriptor on the type definition, see
   `docs/developer/slide-types.md`).
2. **The "Edit all text" bulk modal** (`client/views/editor/bulk-edit-modal.js`) -
   the non-wysiwyg mode: all content fields in one list on the left, a live
   contain-scaled preview on the right, ‹ x/N › navigation across the deck.
   It mounts the *existing* form field renderers in a `contentOnly` mode
   (no chrome, no Background/Accessibility), so items add/remove/reorder,
   markdown editors and validation are parity-safe **by construction** - it
   renders every non-Background/non-a11y field a type has.
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
PR #191); the re-audit below restored every field in the same class.

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

## The inspector rail

The editor is a 3-column grid, slides | canvas | inspector
(`client/styles/base/01-core/20-editor-layout.css`). The inspector column
sits on the **right**, has a drag-resizable width on its left edge
(`client/views/editor/inspector-resize.js`, `--inspector-width`, min 320px,
default 340px), and is a **toggleable rail with swappable panes**
(`client/views/editor/inspector-panes.js`):

- Exactly one pane is active at a time. Panes: **settings**, **comments**
  (the deck-level comment threads, incl. jump-to-slide and
  highlight-from-marker via `data-comment-id`) and **notes** (presenter
  notes, `client/views/editor/notes-pane.js`).
- The rail is driven by the **pane switcher**: a labeled tab group
  ([Inspector | Comments | Notes]) at the far right of the topbar, in its
  own visual zone exactly above the rail. It is always visible - also with
  the rail closed - which is what makes the rail findable.
- **Pressed-state semantics**: `aria-pressed` on a tab means "rail open on
  MY pane", so a pane switch flips one tab off and the other on. Clicking
  the active pane's own tab dismisses the rail.
- **The pane's × dismisses the whole rail** (same as the tabs; hiding just
  the pane would leave an open empty rail). A dismissed rail gives the
  canvas the space (`is-inspector-collapsed`; the panel leaves the grid
  entirely).
- The unseen-comments badge sits on the Comments tab, so it is visible
  while the rail is closed.
- **Notes are a pane, not an under-canvas block**: notes are rarely used
  and only matter again while presenting, so they live out of sight. The
  textarea keeps its collab seams (`data-collab-field-key="notes"` for
  presence, the same element reference for the live-edits binder); the
  "Notes (QR)" companion flow sits in the pane header. Panes are
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
and the zoom button. The inspector pane header is pure pane chrome (pane
name + ×).

The topbar holds only **deck-level** chrome, in zones: identity (back,
title, save status, presence) - deck editing (undo/redo, language) - deck
actions (Export, Share, deck grid, Present as the primary CTA with a
caret menu holding Companion) - utilities (user menu, ⋯ with AI analysis,
Translate, Versions, Settings, Keyboard shortcuts) - and, far right past
a separator, the pane switcher. At narrow widths the bar sheds
progressively (title shrinks; deck grid mirrors into ⋯ at ≤1024; undo/
redo ≤820; avatar ≤600) so the pane switcher never falls off-screen.

## What the settings pane renders (the keeps-model)

The pane renders Background, Accessibility, and per type only the keys in
**`INSPECTOR_KEEPS`** in
`client/views/editor/editor-form/inspector-form.js`. That map is the code
mirror of the coverage audit table below - **change the table and the map
together**.

- **Unknown (custom/fork) types fall back conservatively**: every schema
  field *except* the proven-wysiwyg-covered keys (`getInlineFormTextKeys`,
  fed by the descriptor's `formText`) stays in the inspector. Dropping more
  would risk orphaning a field the fork has no other surface for.
- Widgets a flat keeps-list can't express (chart data editor, focus
  pickers, icon-card-grid icon+link, per-column image settings) render via
  `renderInspectorExtrasByType` in the same module. Bulky widget blocks
  ("Card icons & links", "Column images & blocks", the image-slide
  animation settings) render as **collapsible groups, default closed**, so
  the pane leads with the at-a-glance settings (layout/variant enums) and
  ends with Background (sticky-open) and Accessibility.

### Selection-aware tabs (`[This element | Slide]`)

Selecting a canvas element grows the pane a **tab bar**; with nothing selected
there is no tab bar - just the slide form (identical to the pre-tab pane).

- **Selection state** lives in the controller (`selectedElement =
  {kind:'image'|'card', idx} | null`), cleared on slide change. Canvas
  interactions set it: a single click on a filled image →
  `onOpenElementSettings({image, idx})` (selects it *and* opens the rail on the
  "This image" tab, the single doorway to everything settable); editing a card's
  text or clicking its icon → `{card, idx}`; a plain-text edit or empty-slide
  click clears it. Double-clicking a filled image, or clicking an empty slot,
  opens the image picker directly (replace / add) rather than the tab.
- **Rendering** (`editor-form.js`): when the selection applies to the slide
  (`elementAppliesToSlide`), per-element widgets render into `elementForm`
  ("This element" tab) and the rest into `form` ("Slide" tab). The active tab
  persists across rerenders and resets to the element on a fresh selection.
  `renderInspectorExtrasByType` routes each type's controls into `elementForm`:
  most image types use the **shared image-element card**
  (`editor-form/image-element-card.js`: replace/delete, alt, fit where the type
  has one, the 3x3 focus grid as the precise fallback to the canvas drag, and
  per-item metadata like a LinkedIn URL); image-text keeps its own per-image
  manager (Images section) plus role + layout; icon-card-grid → just the
  selected card's icon + link.
- **Scope:** every image type carries a "This image" tab - image-slide,
  image-text, gallery, team-cards, content-columns (per selected column),
  logo-wall, quote portraits - plus icon-cards. The shared card is driven by the
  type's inline descriptor (media/focus/fit), so it writes the same focusX/Y
  keys the canvas focal-point drag writes: one value, two representations.

The `data-inspector-section="image"` markers (image-slide, image-text) remain as
a harmless addressing seam; the element tab now surfaces the controls directly.

### "This text" tab (block-level text styling)

A click on a text field selects `{kind:'text', fieldKey}` (a card's text still
selects the card; chart-data/csv selects nothing), which shows a type-agnostic
**"This text"** element tab: **alignment**, a **theme colour token** and a
3-step **size** scale (S/M/L, default M) (`text-element-card.js`). It writes a
generic, additive override map keyed by the field's `data-inline-field` value:

```json
content.textStyles = { "body": { "align": "center", "color": "accent", "size": "lg" } }
```

`normalizeTextStyles` (`shared/slide-types/text-styles.js`) prunes defaults, so
a click-to-default leaves stored JSON unchanged. The shared `renderSlideHtml`
runs a string post-pass (`injectTextStyles`, mirroring `injectSlideBackground`)
that adds `tf-*` classes to the matching field element — **one code path**, so
the editor canvas, present mode and exports all reflect it. Styles live outside
the markdown, so the WYSIWYG round-trip gate is untouched.

**Colour tokens (`tf-color-muted/-accent`).** Base values: `default` (no
override — follows the slide's automatic, background-aware text colour),
`muted` and `accent`. `muted` is derived from **`currentColor`** — the field's
inherited text colour — dimmed to 72%, so it is band-aware: a mid-grey on a
light slide, a dimmed white on a dark band (quote/chapter, whose text is white
via `--quote-text-color` and which bypass the `--color-text` system). A fixed
light-theme muted grey rendered ~1.5:1 (unreadable) there. `accent` is the
brand accent (`--t-color-accent`); on a same-hue coloured band it can be
low-contrast — a deliberate-choice caveat, not a bug. A former `inverse` =
background-colour token was **dropped** (rollout QA): on text sitting directly
on the slide background it is invisible by construction; old `inverse` values
prune to no override. Alignment (`tf-align-*`) is generic and needs no per-type
work — no core type sets a competing `text-align` on its primary fields.

**Theme text swatches (`tf-color-brand-1/-2/-3`).** The colour control is a
swatch row: the three base tokens above plus any on-brand text colours the
active theme declares via **`theme.textSwatches`** — a list of fixed slots
(`brand-1`/`brand-2`/`brand-3`) each backed by a `--t-color-<slot>` token, with
an optional label (string or `{ nl, en }`, like `backgroundLabels`). Rationale
for a curated theme palette rather than exposing the background swatches
directly: the `--t-slide-bg-*` swatches are *surface fills* (e.g. `lime` is
often white), so they fail as text colours — a theme picks legible on-brand
colours here instead. Normalization (`normalizeTheme`) keeps only slots the
theme actually coloured, so the control never shows a swatch that would resolve
to a no-op `currentColor`; a theme that declares none leaves the three base
tokens. Stored values stay portable tokens: a deck carrying `brand-1` on a
theme that never defined it falls back to the default text colour (the
`currentColor` fallback in the `tf-color-brand-*` CSS), not a broken colour.

**Size scale (`tf-size-sm/lg`).** A plain `em` multiplier would *replace* the
px font-sizes several types set (content body 28/25/22px per density) with a
fraction of the parent size, shrinking rather than scaling. Instead `tf-size-*`
only set a `--tf-size-scale` custom property on the field element (`sm` 0.85,
`lg` 1.2, `md` = no class → fallback 1), and each primary text element
expresses its `font-size` as `calc(<base> * var(--tf-size-scale, 1))`, rolled
out **per type**. Types wired so far: **content** (heading + body, all density
steps), **image-text** (body, all width/density steps), **lijstje** (per-item
title + text, all density steps), **quote** (quote text), **chapter-title**
(title). Other types/fields store the value cleanly but do not yet scale — add
the `calc()` to their primary text element to enable it.

## Per-type coverage audit (executed 2026-07-16, re-audited 2026-07-21)

**Re-audit 2026-07-21** (scripted schema-vs-surfaces walk + hand review,
under the tightened invariant above): every field the 2026-07-16 table had
parked in its "Bulk modal (only home)" column was reclassified. Config/
metadata fields moved to the inspector keeps (the table below reflects the
new state): content + image-text `actions`;
split-partner `logos`/`logo{n}Alt`/`bgImage`/`bgAlt`; video
`source`/`bunnyLibraryId` (PR #191); embed `embedUrl` (PR #191); countdown
`zeroText`; poll/likert `onCloseTarget`; feedback `placeholder`;
lead-capture `thankYouTitle`/`thankYouMessage`/`privacyText`/`privacyUrl`;
chart `xLabel`/`yLabel`/`series1Label`/`series2Label` (rendered inside the
chart-config block, per chart type, in inspector AND bulk); end
`contactUrl`/`social1/2Label`/`social1/2Url`. **Content text** that relies
on the bulk modal stays accepted: kpi metric subfields (delta/note), table
row cell ops (column add/remove), content-columns numbered texts,
text-blocks rows editor, quote extra `quotes[]`, custom-html `html`/`css`
(code editors are the bulk surface by design), freeform `elements[]` (own
canvas editor). Deprecated/hidden fields (card-stack `card{n}Label`) need
no surface.

Method: scripted walk of all 39 core types' `SLIDE_TYPES[type].fields`
against `INLINE_DESCRIPTORS` + `getInlineFormTextKeys` (+ `media`/`cards`
descriptors), then hand-reviewed. Every schema field of every type is
classified below; **no orphans found**.

Column semantics:

- **Wysiwyg**: fully editable on the slide surface (in-place text, ghosts
  for optional fields, cards add/remove/reorder, images set/replaced via the
  picker - double-click a filled image or click an empty slot; alt/fit/focus
  live in the "This image" inspector tab). Where a row below says "via
  popover" it predates the editing-surfaces track; read it as "via the canvas
  image picker + the This-image tab".
- **Bulk modal**: fields whose *only* non-inspector text home is the "Edit
  all text" modal. The modal renders *every* non-Background/non-a11y field
  by construction, so wysiwyg-covered fields are also there; this column
  lists what *relies* on it.
- **Inspector keeps**: settings/design fields the inspector retains (enums,
  icons, URLs-as-config, focus points, chart config, code, Background,
  Accessibility).

Shared by **all 39 types**, not repeated per row: `slideBgImage`,
`slideBgFit`, `slideBgFocusX/Y`, `slideBgOverlay`, `slideBgText`,
`slideLogo` (Background section) and `a11yTitle`, `a11ySummary`
(Accessibility) → **inspector keeps**. The per-type `background` enum and
freeform's `bgCustomColor` also render in the Background section →
**inspector keeps**.

Legacy numbered aliases (team-cards `card{n}*`, logo-wall `logo{n}*`,
icon-card-grid `card{n}*`, text-blocks `row{n}*`, process `steps`, funnel
`stages`, cycle `stages`): inactive when the array field is in use - the
form renders only the active collection (`inactiveCollectionKeys`), so
they follow the array field's classification and are not separately
homed. Not listed per row.

| Type | Wysiwyg | Bulk modal (only home) | Inspector keeps | Notes |
|---|---|---|---|---|
| title | title, subheading, byline, attribution | - | logoCorner | background image unified onto the shared `slideBgImage` (Background section) — the type's own `bgImage`/`bgAlt` were removed (title-bg-unification) |
| chapter-title | title, subheading | - | layout | |
| content | title, subheading, body | - | layout (labelled "Text columns"), density, actions | the `layout` enum here only toggles 1/2 text columns, so it's shown as "Text columns"; the chip owns structural variants. actions = CTA config → inspector (re-audit 2026-07-21) |
| table | title, caption; rows add/remove inline | rows[] cell texts (+ "Edit table" modal) | headerRow, animateByCell, tableStyle | slide-view entry points for the table modal are an open follow-up |
| list / lijstje | title, subheading, items[] (title/text, full) | - | variant, layout, density | |
| kpi-metrics | title, subheading, bottomSubheading; metrics add/remove/reorder | metrics[] value/unit/label/note | accent, countUp | metric subfields not inline (delta/note controls) |
| split-partner-title _(archived)_ | label, title, subheading | - | logos[], logo1-5Alt, bgImage, bgAlt | archived 2026-07-21 (`deprecated: true`): hidden from picker + AI, but existing decks still render and their inspector keeps these |
| image-text | title, body, caption; images[] src+alt via popover (per cell) | - | imageRole, imageSide, imageWidth, imageFit, imageBackground, focusX/Y, density | `layout` (structural variant) is chip-only in the inspector; also carries an "Images" section: per-image alt/fit/focus, reorder, row's third image (phase-2 catalogue) |
| video | title | - | source, autoplay, bunnyLibraryId | source is a URL/ID → inspector (PR #191) |
| team-cards | title, subheading(s), bottomSubheading; members[] incl. photo popover (image/name/byline/linkedin) + add/remove/reorder | - | textPosition, imageShape, imageAspect, showPhotoFrame, columnSplit | |
| logo-wall | title, subheading; logos[] photo popover (image/name/link) | - | - | logos add/remove is form-only (known residue) |
| card-stack | title, subheading; card{n}Title/Body in-place | - | cardCount | card{n}Title/Body are canvas-inline; card{n}Label is deprecated+hidden (no surface needed); no array migration yet |
| icon-card-grid | title, subheading, bottomSubheading; items add/remove/reorder | items[] title/body | icon (picker), link, layout | icon picker + link keep the form |
| payoff | - | - | - | zero content fields (theme-driven logo) |
| quote | quote, authorName, authorTitle; author images via popover | - | - | |
| image | title, subheading, bottomSubheading, caption; image+alt via popover | - | imageRole, layout, focusX/Y, zoomSteps, zoomLevel, zoomPositions | zoom config is settings |
| embed | title | - | embedUrl, aspectRatio, sandbox | embedUrl → inspector (PR #191) |
| countdown | title | - | durationMinutes/Seconds, autoStart, flashOnZero, soundOnZero, zeroText | |
| poll | question, option1-4 (ghosts) | - | onClose, onCloseTarget | |
| likert | question, option1-10 (ghosts) | - | onClose, onCloseTarget | |
| likert-slider | question, minLabel, maxLabel | - | - | |
| feedback | question | - | placeholder | |
| lead-capture | title, description, nameLabel, emailLabel, submitLabel | - | thankYouTitle, thankYouMessage, privacyText, privacyUrl | thank-you state not visible on canvas → inspector (re-audit 2026-07-21) |
| follow-invite | - | - | - | zero content fields (content auto-managed) |
| chart | title, subheading, bottomSubheading | - | chartType, data (own markdown modal), showLegend, showValues, pieLabelMode, xLabel, yLabel, series1/2Label (per chart type) | chart data keeps its dedicated modal (known residue); axis/series labels render inside the config block, inspector AND bulk |
| text-blocks | title, subheading, bottomSubheading; rows[]+blocks two-level add/remove/reorder + texts | rows[] editor (incl. per-row color/arrow enums) | - | array-canonical; texts also inline |
| content-columns | title, subheading, bottomSubheading; col{n}Image/Alt via popover incl. empty-slot add | col{n}Title/Text, col{n}Block{m}Title/Body (active numbered schema) | columnCount, col{n}ImageFit, col{n}ImageFocusX/Y, col{n}BlockCount | array migration is a parked follow-up |
| comparison | title, subheading, bottomSubheading, leftTitle/Body, rightTitle/Body, verdict | - | - | fully inline |
| process | title, subheading, bottomSubheading; items[] (title/text, full) | - | direction | |
| timeline | title, subheading, bottomSubheading; items[] (date/title/text, full) | - | - | |
| matrix | title, subheading, bottomSubheading; cells[] (title/body, full) | - | - | cell tone enum edits via the cells[] items editor (bulk) |
| funnel | title, subheading, bottomSubheading; items[] (label/value/text, full) | - | - | |
| pyramid | title, subheading, bottomSubheading; levels[] (label/text, full) | - | - | |
| cycle | title, subheading, bottomSubheading, centerLabel; items[] (label/text, full) | - | - | |
| gallery | title, subheading, bottomSubheading; images[] popover (src/alt) + caption inline + add/remove/reorder | images[] cards (per-image focusX/Y) | layout | |
| freeform | - | elements[] via the dedicated freeform canvas editor | snapToGrid | freeform has its own editing surface; bulk modal renders the raw items as fallback |
| custom-html | - | html, css (code editors, capability-gated) | - | |
| end | title, body, contactName, contactEmail, contactPhone | - | contactUrl, social1/2Label, social1/2Url | URLs/labels → inspector (re-audit 2026-07-21) |

Documented deviations from the audit's original shorthand, all in the safe
direction (already folded into the table above; repeated here because
`INSPECTOR_KEEPS`'s JSDoc refers to them):

- table `colCount`, team-cards `cardCount` and logo-wall `logoCount` are
  derived mirrors managed by their editors/arrays and were never rendered
  as form controls; the inspector does not resurrect them (their ops live
  in the table editor / card add-remove, in bulk modal + wysiwyg).
- gallery and icon-card-grid keep their `layout` enum (enums are inspector
  material by definition); icon-card-grid `cardCount` is driven by
  add/remove, not a control.

Known residue (fields that keep a form-only or dedicated-surface home,
deliberately): logo-wall add/remove logos (form), card-stack and
content-columns numbered schemas (no array migration yet), chart data
(dedicated markdown modal), table-modal slide-view entry points (open
follow-up).

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
