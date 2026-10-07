# Responsive editor fields (size-intent field rows)

How the editor's inspector column lays out inputs, dropdowns and toggles so
they sit side by side when there is room and stack when there isn't - without
any per-slide-type tuning. This replaced the old fixed `.field-grid.cols-N`
grid.

## The problem it solves

The inspector column (`.inspector-panel`) is **drag-resizable**
(`--inspector-width`, min 320px, default 340px) on desktop, and becomes a
full-width row under the canvas below the 1100px breakpoint (see
`editor-inspector.md`). Its width is therefore independent of the viewport,
so viewport media queries can't drive its internal layout. The old approach
put fields in a CSS grid with a hard column count
(`grid-template-columns: repeat(2, …)`), which forced two columns no
matter how narrow the user dragged the panel - so controls got cramped and
segmented toggles wrapped their buttons onto a ragged second line.

## The mechanism

Two pieces, both at a single chokepoint:

1. **`.field-grid` is a flex-wrap row** (`client/styles/app/editor/inspector/10-field-grid.css`).
   It reflows on its own real width, not the viewport's. Fields grow to fill a
   row and wrap to the next line when they no longer fit.

2. **Each field carries a size intent** - its natural minimum width - as an
   `is-field-*` class on its wrapper. `--field-basis` is the wrap threshold:

   | Class             | `--field-basis` | Used for                                |
   | ----------------- | --------------- | --------------------------------------- |
   | _(default)_       | `10rem`         | text inputs, enums estimated at ≤ 160px |
   | `is-field-narrow` | `7rem`          | number inputs                           |
   | `is-field-wide`   | `17rem`         | enums estimated at ≤ 272px              |
   | `is-field-full`   | `100%`          | textareas, markdown, code, wider enums  |

   The class is **inert outside a `.field-grid`** (the flex rules are scoped to
   direct children), so renderers can stamp it unconditionally.

Two default fields pair up once the column offers ~374px or more (10rem·2 +
gap); below that - including the 340px default width - they stack, which is
exactly the "too narrow" regime. A wide/full control takes its own line on a
narrow column and pairs up again on a wide one (or in the full-width stacked
row below the breakpoint).

## Where the intent is set

- `client/views/editor/fields/basic.js` - `fieldNumber` → narrow;
  `fieldTextarea` / `fieldMarkdown` / `fieldCode` → full.
- `client/views/editor/fields/enum.js` - `fieldEnum` asks `enumControl()`
  (`client/views/editor/fields/enum-fit.js`, B457) for both the control and the class. It estimates the
  width of the options' translated labels (an `icon` option counts as a
  fixed-width glyph): one segmented row that fits the 279px column at the
  minimum inspector width stays segmented, anything wider becomes a dropdown,
  and the estimated width picks the class against the bases above. The option
  count plays no part, and neither does the field key: a glyph is declared on
  the option (`icon: 'side-left'` → `.sb-icon-side-left`). `fieldGrid()`
  builds the row; its legacy `cols` argument is accepted for backward
  compatibility but **no longer drives layout** - grouping is purely semantic
  ("these fields belong together").

## Adding a field

You normally do nothing. An enum option's `label` is a name; an explanation
goes in its `title` (the button tooltip, the dropdown option's title).
`tests/enum-fit.test.js` walks every built-in enum in English and Dutch and
fails on a declaration whose longest label does not fit the column even as a
dropdown, or whose options share a label. For layout: group related fields with `fieldGrid([...])` and the
row arranges itself. Only reach for an explicit size intent if a custom control
has an unusual minimum width - add `is-field-narrow` / `is-field-wide` /
`is-field-full` to its wrapper's class. Do **not** reintroduce a fixed column
count.

## Verifying

Drive the editor and vary the column width (drag the handle, or set
`--inspector-width` on `.layout`). Across 320-560px there should be zero
control overflow and no segmented-button wrapping. When measuring button rows
programmatically, compare each button's `left` to the previous one (a smaller
`left` means a real wrap) - comparing `top` gives false positives because the
active/swatch button can be vertically centered at a different offset.
