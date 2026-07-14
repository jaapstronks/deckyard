# Responsive editor fields (size-intent field rows)

How the editor form column lays out inputs, dropdowns and toggles so they sit
side by side when there is room and stack when there isn't - without any
per-slide-type tuning. This replaced the old fixed `.field-grid.cols-N` grid.

## The problem it solves

The editor form column (`.editor-panel`) is **drag-resizable**
(`--editor-panel-width`, min 320px, default ~400px). Its width is therefore
independent of the viewport, so viewport media queries can't drive its
internal layout. The old approach put fields in a CSS grid with a hard column
count (`grid-template-columns: repeat(2, …)`), which forced two columns no
matter how narrow the user dragged the panel - so controls got cramped and
segmented toggles wrapped their buttons onto a ragged second line.

## The mechanism

Two pieces, both at a single chokepoint:

1. **`.field-grid` is a flex-wrap row** (`client/styles/base/03-controls-and-forms.css`).
   It reflows on its own real width, not the viewport's. Fields grow to fill a
   row and wrap to the next line when they no longer fit.

2. **Each field carries a size intent** - its natural minimum width - as an
   `is-field-*` class on its wrapper. `--field-basis` is the wrap threshold:

   | Class            | `--field-basis` | Used for |
   |------------------|-----------------|----------|
   | *(default)*      | `10rem`         | text inputs, selects, 2-option toggles |
   | `is-field-narrow`| `7rem`          | number inputs |
   | `is-field-wide`  | `17rem`         | 3-4 option segmented controls |
   | `is-field-full`  | `100%`          | textareas, markdown, code, 5+ option controls |

   The class is **inert outside a `.field-grid`** (the flex rules are scoped to
   direct children), so renderers can stamp it unconditionally.

At the ~400px default column, two default fields pair up (10rem·2 + gap ≤ the
~358px inner width); they stack once the column is dragged below ~374px, which
is exactly the "too narrow" regime. A wide/full control takes its own line on a
narrow column and pairs up again on a wide one.

## Where the intent is set

- `client/views/editor/fields/basic.js` - `fieldNumber` → narrow;
  `fieldTextarea` / `fieldMarkdown` / `fieldCode` → full.
- `client/views/editor/fields/enum.js` - `fieldSegmented` derives the class
  from the option count (2 → default, 3-4 → wide, 5+ → full). `fieldGrid()`
  builds the row; its legacy `cols` argument is accepted for backward
  compatibility but **no longer drives layout** - grouping is purely semantic
  ("these fields belong together").

## Adding a field

You normally do nothing: group related fields with `fieldGrid([...])` and the
row arranges itself. Only reach for an explicit size intent if a custom control
has an unusual minimum width - add `is-field-narrow` / `is-field-wide` /
`is-field-full` to its wrapper's class. Do **not** reintroduce a fixed column
count.

## Verifying

Drive the editor and vary the column width (drag the handle, or set
`--editor-panel-width` on `.layout`). Across 320-560px there should be zero
control overflow and no segmented-button wrapping. When measuring button rows
programmatically, compare each button's `left` to the previous one (a smaller
`left` means a real wrap) - comparing `top` gives false positives because the
active/swatch button can be vertically centered at a different offset.
