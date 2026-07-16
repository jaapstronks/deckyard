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
   of repeatable items (two-level for text-blocks rows/blocks), and a media
   popover (image + alt + extras) including first-image-into-empty-slot.
   Descriptor registry: `client/views/editor/inline-edit/descriptors.js`
   (custom types declare an `inline` descriptor on the type definition, see
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
it's coming".** Conversely, double coverage is harmless: enums deliberately
render in the bulk modal too (it mounts the whole content half by
construction; filtering them out would complicate the
parity-by-construction argument, and the one-list job benefits from having
layout context next to text).

## The inspector rail

The editor is a 3-column grid, slides | canvas | inspector
(`client/styles/base/01-core/20-editor-layout.css`). The inspector column
sits on the **right**, has a drag-resizable width on its left edge
(`client/views/editor/inspector-resize.js`, `--inspector-width`, min 320px,
default 340px), and is a **toggleable rail with swappable panes**
(`client/views/editor/inspector-panes.js`):

- Exactly one pane is active at a time. Panes today: **settings** (topbar
  "i" button) and **comments** (topbar comments button; the deck-level
  comment threads, incl. jump-to-slide and highlight-from-marker via
  `data-comment-id`).
- **Pressed-state semantics**: `aria-pressed` on a topbar toggle means
  "rail open on MY pane", so a pane switch flips one button off and the
  other on. Toggling the active pane's own trigger dismisses the rail.
- **The pane's × dismisses the whole rail** (same as the topbar toggles;
  hiding just the pane would leave an open empty rail). A dismissed rail
  gives the canvas the space (`is-inspector-collapsed`; the panel leaves
  the grid entirely).
- The unseen-comments badge stays on the comments topbar button, so it is
  visible while the rail is closed.
- **Notes stay under the canvas**, not in a pane: the notes textarea is
  wired into the collab presence/live-edits binder and the notes-QR
  session; making it a pane buys little and risks those seams. Revisit only
  if the pane model grows a third tenant.
- Lock/read-only gating is **not** the pane host's job: every editing
  surface consumes the state-driven `getSlideLockKind` seam itself (see
  `editor-controller.js`); slide locks are also enforced server-side
  (`enforceSlideWritePolicy`).

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
  `renderInspectorExtrasByType` in the same module.

## Per-type coverage audit (executed 2026-07-16)

Method: scripted walk of all 39 core types' `SLIDE_TYPES[type].fields`
against `INLINE_DESCRIPTORS` + `getInlineFormTextKeys` (+ `media`/`cards`
descriptors), then hand-reviewed. Every schema field of every type is
classified below; **no orphans found**.

Column semantics:

- **Wysiwyg**: fully editable on the slide surface (in-place text, ghosts
  for optional fields, cards add/remove/reorder, media popover incl.
  empty-slot adds).
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
| title | title, subheading, byline, attribution | bgImage, bgAlt | logoCorner | bgImage = title-specific hero bg (preset strip in form) |
| chapter-title | title, subheading | - | layout | |
| content | title, subheading, body | actions[] (label/url/style) | layout, density | actions = CTA buttons; url/style stay form-only |
| table | title, caption; rows add/remove inline | rows[] cell texts (+ "Edit table" modal) | headerRow, animateByCell, tableStyle | slide-view entry points for the table modal are an open follow-up |
| list / lijstje | title, subheading, items[] (title/text, full) | - | variant, layout, density | |
| kpi-metrics | title, subheading, bottomSubheading; metrics add/remove/reorder | metrics[] value/unit/label/note | accent, countUp | metric subfields not inline (delta/note controls) |
| split-partner-title | label, title, subheading | logos[], logo{n}Alt, bgImage, bgAlt | - | partner logos have no media popover yet |
| image-text | title, body, caption; image+alt via popover | - | imageRole, imageSide, imageWidth, imageFit, imageBackground, focusX/Y, density | |
| video | title | source, bunnyLibraryId | autoplay | source is a URL/id (text home = bulk) |
| team-cards | title, subheading(s), bottomSubheading; members[] incl. photo popover (image/name/byline/linkedin) + add/remove/reorder | - | textPosition, imageShape, imageAspect, showPhotoFrame, columnSplit | |
| logo-wall | title, subheading; logos[] photo popover (image/name/link) | - | - | logos add/remove is form-only (known residue) |
| card-stack | title, subheading | card{n}Title/Label/Body (active numbered schema) | cardCount | no array migration yet; count stays inspector (known residue) |
| icon-card-grid | title, subheading, bottomSubheading; items add/remove/reorder | items[] title/body | icon (picker), link, layout | icon picker + link keep the form |
| payoff | - | - | - | zero content fields (theme-driven logo) |
| quote | quote, authorName, authorTitle; author images via popover | - | - | |
| image | title, subheading, bottomSubheading, caption; image+alt via popover | - | imageRole, layout, focusX/Y, zoomSteps, zoomLevel, zoomPositions | zoom config is settings |
| embed | title | embedUrl | aspectRatio, sandbox | |
| countdown | title | zeroText | durationMinutes/Seconds, autoStart, flashOnZero, soundOnZero | |
| poll | question, option1-4 (ghosts) | onCloseTarget | onClose | |
| likert | question, option1-10 (ghosts) | onCloseTarget | onClose | |
| likert-slider | question, minLabel, maxLabel | - | - | |
| feedback | question | placeholder | - | |
| lead-capture | title, description, nameLabel, emailLabel, submitLabel | thankYouTitle, thankYouMessage, privacyText, privacyUrl | - | thank-you state not visible on canvas |
| follow-invite | - | - | - | zero content fields (content auto-managed) |
| chart | title, subheading, bottomSubheading | xLabel, yLabel, series1/2Label | chartType, data (own markdown modal), showLegend, showValues, pieLabelMode | chart data keeps its dedicated modal (known residue) |
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
| end | title, body, contactName, contactEmail, contactPhone | contactUrl, social1/2Label, social1/2Url | - | |

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
  handle and the canvas-collapse (`is-preview-collapsed`) live here.
- **≤1100px**: 2 columns - slides | canvas - with the inspector as a
  **full-width row under the canvas** (grid-template-areas; row
  `minmax(200px, 38vh)`, 42vh at ≤820px). Not an overlay: the rail-toggle
  machinery keeps working unchanged (dismissed = full-height canvas) and
  nothing floats over the wysiwyg surface. The inspector resize handle is
  hidden (the width is the full column); `is-preview-collapsed` is
  neutralized and its toggle hidden - the stored preference resumes on
  desktop widths.
- **821-1024px**: additionally swaps the slides column for the
  auto-collapse rail.
- **≤820px**: drops the slides column entirely; slides live in a drawer
  (`client/views/editor/responsive-drawers.js`, which only manages the
  slides drawer).

The canvas is the primary editing surface at every width.
