# WYSIWYG inline editing on the slide canvas

How the click-to-edit layer on the slide canvas works: users click rendered
slide text and type in place, add empty optional fields via ghost chips,
add/remove/reorder repeatable cards, edit images through an in-slide media
popover, and edit Markdown in a modal. It is one of the three editing
surfaces (canvas / bulk "Edit all text" modal / inspector rail) described in
`docs/reference/editor-inspector.md`; this doc covers the canvas layer
itself - the mechanism, the module layout, and the descriptor registry that
future contributors extend.

## Why this works in this stack (the enablers)

- The slide canvas renders **inline in the same document** (no iframe / shadow
  DOM), so handlers attach directly to the rendered slide (the `.thumb`
  element in `editor-controller.js`).
- The slide-type **field schema is fully machine-readable**
  (`SLIDE_TYPES[type].fields` with `key`, `type`, `required`, `maxLength`,
  `itemFields`, `minItems`/`maxItems`, `itemDefaults`). Ghosts, card bounds
  and field kinds are derived from it, not hardcoded - descriptors stay tiny.
- There was an **overlay precedent** (`comment-markers.js`) that survives the
  slide remount, which is the exact pattern the affordance overlay reuses.

## The one hard problem: the rerender guard

`mountSlideInto()` wipes `thumb.innerHTML` on **every** canvas rerender
(there is no fine-grained update). Naive `contentEditable` would be
destroyed mid-type. The solution, in `editor-controller.js` +
`inline-editor.js`:

- `rerenderPreview()` **returns early while an inline edit is active**
  (`inlineEditor.isEditing()`), so the element the user is typing in - and
  their caret/selection - is never destroyed.
- Commits schedule a **deferred** rerender (`requestAnimationFrame`) that is
  cancelled if the user immediately starts editing another field, keeping
  field-to-field editing smooth.
- All decoration (ghost chips, card buttons, clear buttons, outlines, grips)
  is stateless against the DOM: it is rebuilt in `inlineEditor.refresh()`,
  which the controller calls after every mount. Custom (server-rendered)
  slide types re-apply affordances via the `slide-server-rendered` event.

The canvas mounts with `mode: 'edit'`, which lets slide types suppress
non-editing affordances (e.g. icon-card link overlays that would intercept
click-to-edit); all other runtime guards treat it like the default mode.

## Architecture

Inline editing is opt-in **per slide type**. A type participates only when
both:

1. its renderer emits `data-inline-field="<path>"` on editable elements, and
2. it has a descriptor (core registry entry, or an `inline` descriptor on
   the type definition for custom/fork types).

Types without both are completely untouched.

| Piece | File |
| --- | --- |
| Descriptor registry + `getInlineDescriptor` / `getInlineFormTextKeys` | `client/views/editor/inline-edit/descriptors.js` |
| Field-path read/write + schema-meta resolver (`getByPath`, `setByPath`, `fieldMetaForPath`, `isEmptyValue`) | `client/views/editor/inline-edit/field-path.js` |
| Main module (edit lifecycle, click routing, ghosts, cards, clear, markdown modal, icon picker, convert, reorder drag) | `client/views/editor/inline-edit/inline-editor.js` |
| Overlay layer (affordance positioning on the unscaled thumb) | `client/views/editor/inline-edit/overlay.js` |
| In-slide media popover (image + alt + extra fields) | `client/views/editor/inline-edit/media-popover.js` |
| Pure reorder geometry (pointer → insertion gap + indicator line) | `client/views/editor/inline-edit/reorder-geometry.js` |
| One-time "click any text to edit" coach mark | `client/views/editor/inline-edit/coach-mark.js` |
| Wiring + rerender guard + convert action | `client/views/editor/editor-controller.js` |
| Lightbox-click suppression on inline-editable slides | `client/views/editor/preview-panel.js` |
| Styles | `client/styles/base/04-editor-and-misc/105-inline-edit.css` |

### The overlay layer

The slide renders into a fixed 1600x900 canvas and is
`transform: scale(var(--thumb-scale))`-d down to fit the `.thumb` - anything
rendered *inside* it shrinks with it (a 14px chip becomes ~4px). All
affordances therefore live on an overlay appended to the **unscaled**
`.thumb` (`overlay.js`, the comment-markers pattern), positioned by measuring
the target element's rect, so chips / buttons / outlines render at real
screen pixels at any zoom. Corner badges sit on the field's corner
(macOS-badge style); the thumb gets `overflow: visible` in inline-edit mode
so overhangs aren't clipped. Ghost chips sharing an anchor pack into a
horizontal row.

### Field paths

A field path is a plain key (`"title"`), a flat numbered key
(`"col2Title"`), or a dotted items path (`"items.0.title"`, nested:
`"rows.0.blocks.1.body"`). The renderer emits them as `data-inline-field`;
`getByPath`/`setByPath` read/write them (numeric segments create arrays);
`fieldMetaForPath` walks nested `itemFields` so e.g. nested markdown opens
the modal. Editing seeds from the **raw stored value**, not the rendered
text, so render transforms (curly quotes, single-line collapsing) never
drift into the data.

### Ghost spawn: the sentinel

Clicking a "+ Field" chip writes a zero-width-space sentinel
(`NEW_FIELD_SENTINEL`, `​`) into the field and rerenders through the
real renderer, then edits the element it emitted - so the first-time edit
gets the correct tag/class/font size with zero descriptor work. The sentinel
is never persisted: commit/cancel replace it, and an abandoned empty edit
does not dirty the deck. A reanchoring fallback spawns a bare host if a
renderer lacks the field.

## Interaction kinds

- **Plain string** → in-place `contentEditable` (`plaintext-only`). Enter
  commits, Escape cancels; `maxLength` and single-line are enforced. Commit
  writes to content, syncs the side surface (`rerenderEditor`, thumb-safe),
  saves.
- **Markdown** → modal (`.ie-md-modal`) reusing the canonical markdown
  editor from `fields/basic.js` (`fieldMarkdown`, full toolbar) over a
  dimmed backdrop - reads as a separate mode.
- **CSV / chart data** → modal (`.ie-md-modal.is-csv`, `openCsvModal`)
  reusing the same modal chrome as markdown but hosting the shared grid
  editor (`fields/csv-grid.js`, chart-type-aware grid + Raw CSV toggle).
  Used by the chart `data` field so clicking a chart opens a data grid, not
  the prose toolbar. Grid keyboard nav is spreadsheet-like: Up/Down across
  rows (the header is row -1), Enter walks down and appends a row at the
  bottom, Left/Right hop columns only when the caret is at the cell edge.
  Pasting into the top-left header cell rebuilds the grid (header
  auto-detected via `applyHeaderPaste`); pasting into any other header cell
  fills that column in place; pasting a TSV/CSV block into a body cell fills
  outward from it (Sheets/Excel paste).
- **Empty optional field** → hover-revealed "+ Label" ghost chip at an
  anchor; click spawns via the sentinel and starts editing.
- **Filled optional field** → hover-revealed clear (×, `.ie-clear`) that
  empties the value; the renderer omits it, layout reclaims the space, the
  ghost returns.
- **Repeatable items** → schema-driven add ("+ Add item") / remove (×),
  bounded by `minItems`/`maxItems`, seeded from `itemDefaults`. Two-level
  for text-blocks (rows → blocks).
- **Card reorder** → a grip (`.ie-card-grip`) on the overlay next to the ×;
  pointer-drag maps to an insertion gap with an indicator line
  (`reorder-geometry.js` - works for horizontal rows, vertical stacks and
  wrapping grids without special-casing), drop moves the array item. Drag
  lives on the grip only, so card clicks stay click-to-edit. Esc cancels.
- **Images** → clicking an element tagged `data-inline-photo` opens the
  media popover (image via the shared `openImagePicker` seam + alt text +
  optional extras like a LinkedIn URL), including first-image-into-empty-slot
  where the type renders a placeholder. Preview and alt only appear once
  there **is** an image; on an empty slot focus starts on "Choose / upload…".

### The empty-image placeholder

Every empty slot is one `imagePlaceholderHtml()` box
(`shared/slide-types/helpers.js`), used by image, image-text, gallery,
content-columns, logo-wall, quote, team-cards and freeform. It emits the
shared `image-placeholder` base class, the glyph, `is-empty` (the hook the
inline editor keys off), and `aria-hidden` — the box is decorative; the
accessible affordance is the "Add image" chip.

Each type keeps a **modifier** class (`quote-portrait`, `cc-image-placeholder`,
…) because that is what its own CSS targets to size and colour the slot; a
112px round portrait and a full-bleed frame share nothing there. Base styling
lives in `client/styles/slides/00-patterns.css`.

Labels come from `SLIDE_COPY` via `ctx.lang` — they used to be hardcoded per
type, which is how image-text said "Afbeelding" while image-slide said "Image"
in the same deck. Small slots pass `compact: true`: the helper drops the label
(it cannot fit) and the glyph scales with the slot instead of a fixed 72px.

The chip is centred on the placeholder and says the same thing as the glyph,
so the placeholder's inner fades on hover — one rule, keyed on the shared base
class, in `105-inline-edit.css`.
- **Image drag & drop** → an EMPTY `data-inline-photo` placeholder (and its
  overlaid `+ Add image` chip) is a drop target for an image file dragged from
  the desktop. A dropped file is always an *upload* (browse-vs-upload split), so
  it goes straight to the single upload destination via the exported
  `uploadFile()` (`image-library/upload.js`) — no source chooser, ImageKit stays
  browse-only. The attach reuses `resolveMediaTarget()` + the popover's
  markDirty/requestSave/rerender path (collab + undo parity). Gated on
  `features.disableUploads` (off in imagekit-only / sandbox / demo);
  `isFileDrag()` ignores internal card-reorder drags. Empty slots only —
  replacing a filled image stays a popover action.
- **Icons** → clicking an element tagged `data-inline-icon` opens the
  canonical icon-picker modal and writes to the emitted path.
- **Type conversion** → "+ Add image" / remove-image-area affordances that
  convert the slide type underneath (see `convert` below), via the shared
  convert seam (`convert-slide-action.js`: `convertSlideToType` /
  `canConvertSlideTo`, lossy-confirm included).

Discoverability: hovering the slide reveals a thin dashed outline on **all**
editable regions at once (Keynote-style); the field under the cursor gets a
stronger tint (`is-hot`); the active edit gets a solid ring that tracks the
text. A one-time coach mark ("Click any text on the slide to edit it",
`coach-mark.js`) shows once ever (`editor.inline.coachSeen` in
localStorage), auto-dismissing on the first edit or after ~12s.

Gating is state-driven, not class-driven: the controller passes
`getCanEdit: () => !readOnlyMode && !getSlideLockKind(slideId)` - the lock
seam is the source of truth, the shell CSS classes are presentation only.

## Descriptor reference

`INLINE_DESCRIPTORS` in `inline-edit/descriptors.js` maps slide type →
descriptor. The core map wins; a type without a core entry falls back to an
`inline` descriptor declared on the slide-type definition itself - the
extension seam for custom types (arrives via `/api/slide-types`; JSON-only,
so function-valued options are core-map-only). Everything beyond the
descriptor (field type, required, maxLength, item schema, min/max counts) is
read from `SLIDE_TYPES[type].fields`.

| Knob | Semantics |
| --- | --- |
| `ensure` | Canonicalizer `(content) => content` run once per mount (in `refresh`, before decorating) for dual-model types whose inline attributes target a canonical array. `ensureLogos` / `ensureMembers` migrate the legacy numbered fields into `logos[]` / `members[]`, so the media popover and card affordances always have a stable, mutable target - which lets those renderers emit the inline attributes unconditionally (no `useLogos` / `useMembers` gate). Idempotent, editor-only, mutates in place, does not dirty the deck. Function-valued → core-map-only. Same family as `ensureImageTextImages`. |
| `ghosts[]` | Chips for empty optional fields: `{ field, anchors: [{sel, pos, chip}] }`. |
| `ghosts[].anchors` | Ordered fallback list; first selector found in the DOM wins (`.header` when present, `.slide-inner` otherwise). `pos` = DOM insertion for the spawned editable (`prepend`/`append`/`before`/`after`); `chip` = overlay placement mode. Legacy `{ field, anchor, pos }` still works. |
| `ghosts[].group` | Ghosts sharing a `group` show only the first empty one - sequential fields (poll option1..4, likert option1..10) get one "+ Option N" chip for the next slot. |
| `itemGhosts[]` | Ghosts for optional per-item subfields the renderer omits when empty: `{ list, field, item, within?, chipAnchor?, pos?, chip?, minIndex? }`. `item` is the item-element selector (elements carry `data-inline-item-index`); `within` an inner element to spawn into. |
| `itemGhosts[].chipAnchor` | Pins the ghost CHIP to the visible card when the item element is a full-height layout column (timeline) - the chip lands on the card, the spawned edit still goes into `within`. |
| `itemGhosts[].minIndex` | Skips earlier items (text-blocks row titles render for rows 2+ only). |
| `cards` | Repeatable-items add/remove/reorder, driven by the schema's `minItems`/`maxItems`/`itemDefaults`: `{ field, container, itemSelector, … }`. When `minItems === maxItems` no add/remove buttons render (matrix). |
| `cards.fieldAliases` | Legacy collection keys (`steps`, `stages`); edits write to the array the renderer actually reads (resolved via `getCollectionKey`, shared helpers). |
| `cards.skipWhenEmpty` | Dual-model guard: no card affordances while the array is empty, so add/remove never grows an `items[]` array on a deck the renderer still reads from legacy numbered fields (icon-card-grid, team-cards, text-blocks). |
| `cards.removeAnchor` | Selector inside the item element to pin the remove × to, for full-height-column items whose visible card is transform-positioned within (timeline `.timeline-card`). |
| `cards.removePlacement` | Overrides the ×'s overlay placement (default `top-right`; `bottom-right` when the top-right corner coincides with another ×, as on text-blocks rows). |
| `cards.addAnchor` / `cards.addPlacement` | Where the "+ Add item" button sits (defaults: `container` + `bottom-center`). `right-center` clamps inward at the container's right-edge midpoint - the insertion point for single-row horizontal layouts that append rightward (timeline, horizontal process). `addPlacement` may be a function `(slide) => mode` when direction-dependent (process); function values are core-map-only. |
| `cards.addLabelKey`/`addLabel`, `removeLabelKey`/`removeLabel` | Override the generic "Add item"/"Remove item" copy per level. |
| `cards.reorder` / `cards.reorderPlacement` | `reorder: false` disables the grip (default: shown when the array has >1 item); `reorderPlacement` moves the grip (default `top-center`; text-blocks rows use `bottom-left` because the top edge collides with the first block's own grip). |
| `cards.child` | A nested card level for two-level list types (text-blocks rows → blocks). One card set per parent item element, scoped to it, writing to `${field}.{parentIdx}.${child.field}`; min/max/defaults from the nested `itemFields`. Same knobs as `cards` plus `ghosts[]` (`{ field, pos?, chip? }`) for cleared child subfields. |
| `media` | Per-image popover on `data-inline-photo="<n>"` elements. **Array mode** (`list` set): `<n>` indexes into `list`, popover mutates the item (`imageField`/`altField`/`extraFields[].key` are item keys). **Flat mode** (no `list`): keys are content keys; a `{n}` token is replaced with `<n>` (`col{n}Image`); single-image types use plain keys, `<n>`=0. `extraFields` entries: `{key, type, label, i18nKey}`. |
| `icons` | Per-icon affordance on `data-inline-icon="<path>"` elements: `{ selector, afterWrite? }`. `afterWrite(slide)` keeps a legacy mirror in sync (icon-card-grid re-syncs numbered fields in items-mode only); function-valued, so core-map-only. |
| `convert` | Type-switch affordances for the "add/remove an image" intent. `addMedia: { toType, anchors }` shows a "+ Add image" chip on a type without an image side; clicking converts (content-slide → image-text-slide) and opens the media popover on the fresh placeholder. `removeMedia: { toType, selector }` shows a hover × on the EMPTY image placeholder; clicking converts back (image-text-slide → content-slide). Both only render when `canConvertSlideTo` approves, so custom types overriding a core name keep working. A filled image must first be cleared via the popover, so removal stays a deliberate two-step. |
| `formText` | Field keys whose editing is FULLY covered by the inline layer (plain text, markdown-modal fields, items whose subfields are all inline). Consumed by the inspector's conservative fallback for types without an `INSPECTOR_KEEPS` entry (`getInlineFormTextKeys` in `editor-form/inspector-form.js`) and rendered by the bulk "Edit all text" modal. A field whose editor carries non-inline controls (icon pickers, KPI delta/note, table column ops) must NOT be listed. |

Note `formText` is narrower than inline coverage: content-columns and
card-stack emit `data-inline-field` for their numbered text fields (inline
editing works there) but don't list them in `formText`, because the inline
layer doesn't cover every operation on them.

## Relationship to the side surfaces

The Pass-6-era collapsed "Text" section in the side form no longer exists;
it was superseded by the wysiwyg-first editor-UI overhaul. Where each field
lives now - canvas / bulk modal / inspector rail - including the
`INSPECTOR_KEEPS` map, the parity invariant, and the full per-type field
audit, is documented in `docs/reference/editor-inspector.md`. This doc's
coverage table below only summarizes what the *canvas* offers per type.

## Per-type coverage

35 of the 39 core types have a descriptor. Legend: "header set" = the shared
`HEADER_GHOSTS` trio (title / subheading / bottomSubheading with anchor
fallbacks).

| Type | Inline text | Ghosts | Cards | Markdown modal | Media / other |
| --- | --- | --- | --- | --- | --- |
| title-slide | title, subheading, byline, attribution | subheading, byline, attribution | – | – | – |
| content-slide | title | subheading | – | body | convert: + Add image → image-text |
| list-slide / lijstje-slide | title, items | subheading + item text | ✅ | – | – |
| quote-slide | quote, name, title | – | – | – | media: author portraits (flat `authorImage{n}`); empty slot clickable in edit mode (first portrait inline) |
| chapter-title-slide | title | subheading | – | – | – |
| image-text-slide | title | caption | – | body | media: `images[]` per cell; convert: × on sole empty placeholder → content-slide |
| timeline-slide | header + item date/title/text | header set + item text (chip on card) | ✅ (add right-center, × on card) | – | – |
| process-slide | header + step title/text | header set + step text | ✅ (alias `steps`, direction-aware add) | – | – |
| funnel-slide | header + stage label/value/text | header set + value/text | ✅ (alias `stages`) | – | – |
| pyramid-slide | header + level label/text | header set + level text | ✅ (`levels`) | – | – |
| cycle-slide | header, centerLabel + stage label/text | header set, centerLabel, stage text | ✅ (alias `stages`) | – | – |
| matrix-slide | header + cell titles | header set | fixed 4/4 (no add/remove) | cell bodies | – |
| kpi-metrics-slide | header + value/unit/label | header set + unit | ✅ (`metrics`) | – | – |
| comparison-slide | header, side titles, verdict | header set, sides, verdict | – | left/right body | – |
| end-slide | title, contact name/email/phone | body, contact fields | – | body | – |
| image-slide | title, subheading, caption, bottom | all four | – | – | media: flat image + alt |
| video-slide / embed-slide / countdown-slide | title | title | – | – | – |
| chart-slide | title, subheading, bottom | subheading, bottom | – | chart data (click the chart) | – |
| split-partner-title-slide | label, title, subheading | label, subheading | – | – | – |
| poll-slide | question, options | next empty option 1–4 (grouped) | – | – | – |
| likert-slide | question, options | next empty option 1–10 (grouped) | – | – | – |
| likert-slider-slide | question, min/max labels | min/max labels | – | – | – |
| feedback-slide | question | – | – | – | – |
| lead-capture-slide | title, field labels, submit label | description | – | description | – |
| table-slide | title, caption, every cell | caption | ✅ rows | – | – |
| gallery-slide | header + captions | header set + per-image caption | ✅ (`images`) | – | media: `images[]` |
| icon-card-grid-slide | header + card title/body | header set | ✅ items-mode only | card bodies | icons: in-slide icon picker (+ numbered re-sync) |
| card-stack-slide | header + card label/body | header set | – (count enum in inspector) | card bodies | – |
| team-cards-slide | header, subheading2, name/byline | header set + member name/byline | ✅ (`ensure` members[]; first block inline) | – | media: photo + alt + LinkedIn (incl. first photo) |
| logo-wall-slide | title, subheading | both | ✅ (`ensure` logos[]; add/remove/reorder; first logo inline) | – | media: `logos[]` incl. empty-slot add (names stay off-canvas: aria-only) |
| text-blocks-slide | header, row titles, block title/body | header set + row title (rows 2+) | ✅ two-level rows → blocks | block bodies | – |
| content-columns-slide | header, col titles, block title/body | header set | – | col text, block bodies | media: flat `col{n}Image` incl. empty-slot add |

Not inline (intentional, no descriptor): `payoff-slide` and
`follow-invite-slide` (no editable content), `freeform-slide` (has its own
canvas editor), `custom-html-slide` (escape hatch, out of scope).

Deliberately not inline within covered types: layout/variant/background/
density enums (inspector; the canvas layout switcher uses the separate
`layoutVariants`/`layoutMirror` seam on the type definition, see
`client/views/editor/layout-switcher.js`), URLs-as-config, focus points,
count enums, a11y fields, KPI delta/note, chart config, thank-you/privacy
fields (render post-submit only).

## Risks / things to watch

- Overlay affordances are transient DOM outside the slide; editing seeds
  from the raw stored value, so they never leak into saved content - keep it
  that way when adding affordances.
- `data-inline-field` / `data-inline-photo` / `data-inline-icon` attributes
  ship to all render surfaces (present, share, export). They're inert there;
  keep them attribute-only (no visible markup).
- Slide-list thumbnails share the renderer and also carry
  `data-inline-field`; always scope canvas assertions/selectors to
  `.thumb.is-clickable-preview`.
- Definition-declared descriptors for custom types are JSON: any
  function-valued knob (`addPlacement` as a function, `icons.afterWrite`)
  works only in the core map.
- `skipWhenEmpty` is load-bearing for the dual-model types: removing it
  would let an add on a legacy deck silently switch the renderer's data
  source.

## Known gaps (verified still open)

- **Accessibility pass**: the overlay affordances (ghost chips, clear ×,
  card add/remove, reorder grip) are mouse-only - no keyboard entry into
  fields (Tab/Enter to edit), no focus-visible states, and no ARIA beyond
  labels on individual buttons.
- **Per-slide translate entry point in the empty-version view**: the
  language-switch invite popover offers only full-deck fill-missing;
  `onTranslateSlide` exists in the form surface but the empty-version view
  has no per-slide entry.
- **Legacy numbered-field decks** (card-stack, content-columns, and legacy
  icon-card-grid/team-cards/text-blocks decks) never get inline card
  add/remove; an array migration would unlock it.
