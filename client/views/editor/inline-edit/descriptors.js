/**
 * Inline-edit descriptors.
 *
 * The inline WYSIWYG editor is intentionally opt-in per slide type. A slide type
 * only becomes inline-editable once:
 *   1. its renderer emits `data-inline-field="<path>"` on the editable elements, and
 *   2. it has an entry here.
 *
 * Everything a descriptor needs beyond that (field type, required/optional,
 * maxLength, item field schema, min/max card counts) is read from the canonical
 * slide-type schema (`SLIDE_TYPES[type].fields`), so descriptors stay tiny.
 *
 * Shapes:
 *   ghosts: affordances shown for optional fields that are currently empty. Each
 *     entry shows a "+ <label>" chip on the overlay and spawns an editable
 *     element at a DOM anchor when clicked.
 *       { field, anchors: [{sel, pos, chip}, ...] }
 *     `anchors` is an ordered fallback list (first selector found in the DOM
 *     wins), so a ghost can target `.header` when it exists and `.slide-inner`
 *     when the header itself is omitted. `pos` is the DOM insertion position for
 *     the spawned editable ('prepend' | 'append' | 'before' | 'after'); `chip`
 *     is the overlay placement mode ('below-start' | 'below-end' | 'top-start'
 *     | 'bottom-start'). Legacy `{ field, anchor, pos }` still works (and
 *     accepts `chip` too).
 *   itemGhosts: ghosts for optional per-item subfields the renderer omits when
 *     empty (e.g. a timeline item's description).
 *       { list, field, item, within?, chipAnchor?, pos?, chip? }
 *     `list` is the primary collection key, `item` the item-element selector
 *     (elements carry data-inline-item-index), `within` an optional inner
 *     element to spawn into. `chipAnchor` is an optional selector inside the
 *     item element to pin the ghost CHIP to (the visible-hint position), for
 *     items whose element is a full-height layout column while the visible card
 *     is transform-positioned within it (timeline) - the chip lands on the card,
 *     not the column. The spawned edit still goes into `within`.
 *   cards: repeatable-items affordances (add/remove) driven by the schema's
 *     minItems / maxItems / itemDefaults.
 *       { field, fieldAliases?, container, itemSelector, removeAnchor?,
 *         removePlacement?, addAnchor?, addPlacement?, addLabelKey?, addLabel?,
 *         removeLabelKey?, removeLabel?, child? }
 *     `fieldAliases` lists legacy collection keys (`steps`, `stages`) so edits
 *     write to the array the renderer actually reads. `removeAnchor` is an
 *     optional selector inside the item element to pin the remove × to, for
 *     items whose element is a full-height layout column while the visible
 *     card is transform-positioned within it (timeline); `removePlacement`
 *     overrides the ×'s overlay placement (defaults to 'top-right' - use
 *     'bottom-right' when the item's top-right corner coincides with another
 *     ×). `addAnchor` overrides the element the "+ Add item" button is placed
 *     against (defaults to `container`); `addPlacement` overrides its overlay
 *     placement mode (defaults to 'bottom-center'). Use 'right-center' for
 *     single-row horizontal layouts whose new item appends to the right
 *     (timeline, horizontal process). `addPlacement` may be a function
 *     `(slide) => mode` when it depends on content (e.g. process direction).
 *     `addLabelKey`/`addLabel` (and the remove variants) override the generic
 *     "Add item"/"Remove item" copy per level.
 *   cards.child: a nested card level for two-level list types (text-blocks
 *     rows -> blocks). One card set is rendered per parent item element,
 *     scoped to it, writing to `${field}.{parentIdx}.${child.field}`; min/max/
 *     itemDefaults come from the nested itemFields schema.
 *       { field, itemSelector, removeAnchor?, removePlacement?, addPlacement?,
 *         addLabelKey?, addLabel?, removeLabelKey?, removeLabel?, ghosts? }
 *     The parent item element anchors the child's "+" chip. `ghosts` lists
 *     optional child-item subfields (`{ field, pos?, chip? }`) whose element
 *     the renderer omits when empty - a chip on the child item re-adds them.
 *   formText: field keys whose editing is FULLY covered by the inline
 *     layer (plain text, markdown modal, and items whose subfields are all
 *     inline-editable). For types without an INSPECTOR_KEEPS entry these are
 *     the keys the settings inspector may omit (conservative fallback in
 *     inspector-form.js); the bulk "Edit all text" modal renders them too.
 *     A field whose editor also carries non-inline controls (icon pickers,
 *     image subfields, KPI delta/note, table column ops) must NOT be listed
 *     here.
 *
 *   media: per-image affordance. Clicking an element tagged
 *     `data-inline-photo="<n>"` opens an in-slide popover (image picker + alt
 *     text + optional extra fields like a LinkedIn URL). Two shapes:
 *       Array mode (`list` set): `<n>` is the index into `list`; the popover
 *         mutates the item object at that index. `imageField` / `altField` /
 *         `extraFields[].key` are the item's own keys.
 *         { list, photoSelector, imageField, altField, extraFields? }
 *       Flat mode (no `list`): the popover mutates `slide.content` directly.
 *         `imageField` / `altField` / `extraFields[].key` are content keys; a
 *         `{n}` token in any of them is replaced with `<n>` (e.g. a per-column
 *         `col{n}Image`). For a single-image type use plain keys and `<n>`=0.
 *         { photoSelector, imageField, altField, extraFields? }
 *     extraFields entries: `{key,type,label,i18nKey}`.
 *
 *   icons: per-icon affordance. Clicking an element tagged
 *     `data-inline-icon="<path>"` opens the canonical icon-picker modal and
 *     writes the chosen name to that content path (the renderer emits the
 *     path for whichever data source it resolved, items or legacy numbered).
 *       { selector, afterWrite? }
 *     `afterWrite(slide)` runs after a successful write, for types that keep
 *     a legacy mirror in sync (function-valued, so core-map-only - same
 *     restriction as function addPlacement).
 *
 *   convert: type-switch affordances for the "add/remove an image" intent.
 *     The user thinks "add an image here", not "convert the slide type", so
 *     the WYSIWYG surfaces the intent and the shared convert seam
 *     (convertSlideToType) moves the type underneath. Both entries are only
 *     shown when the seam actually supports the conversion for this slide
 *     (canConvertSlideTo), so custom types that override a core name keep
 *     working and unrelated types never see the affordance.
 *       addMedia: { toType, anchors: [{sel, chip}, ...] } - a "+ Add image"
 *         chip (same look as ghosts) on a type without an image side.
 *         Clicking converts to `toType` and opens the media popover on the
 *         fresh placeholder. `anchors` works like the ghost anchor list.
 *       removeMedia: { toType, selector } - a hover-revealed × on the EMPTY
 *         image placeholder (`selector`). Clicking converts to `toType`,
 *         removing the reserved image area. A filled image first goes through
 *         "clear the image" (media popover), so removal is a deliberate
 *         two-step; leftover caption/alt text still triggers the lossy
 *         confirm via the shared action.
 *
 *   ensure: a canonicalizer run once per mount (in inline-editor `refresh`),
 *     before decorating, for dual-model types whose inline attributes target a
 *     canonical array (logo-wall → logos[], team-cards → members[]). It
 *     migrates the legacy numbered fields into that array so the media popover
 *     and card affordances always have a stable, mutable target - which lets
 *     the renderers drop their array-backed gate and emit the inline attributes
 *     unconditionally. Idempotent, editor-only, mutates content in place, does
 *     not dirty the deck (a no-op canonicalization). Function-valued, so
 *     core-map-only (same restriction as function addPlacement / icons.afterWrite).
 *       ensure: (content) => content
 *
 * @typedef {Object} InlineDescriptor
 * @property {(content:Object)=>Object} [ensure]
 * @property {Array<Object>} [ghosts]
 * @property {Array<Object>} [itemGhosts]
 * @property {{field:string, fieldAliases?:string[], container:string, itemSelector:string}} [cards]
 * @property {{list?:string, photoSelector:string, imageField:string, altField:string, extraFields?:Array<Object>}} [media]
 * @property {{xField:string, yField:string, cropMode:(slide:Object, idx:number)=>('cover'|'contain')}} [focus]
 *   Draggable focal-point handle on filled images. Resolves the write target
 *   the same way `media` does (item in list mode, `slide.content` in flat mode
 *   with `{n}` substitution), then writes `xField`/`yField` (0..100). The
 *   handle only renders when `cropMode` returns `'cover'`. Function-valued, so
 *   core-map only.
 * @property {{field:string, fallback?:(slide:Object)=>string}} [fit]
 *   Cover/Contain toggle on filled images. Resolves the write target like
 *   `media` (item in list mode, `{n}`-substituted content key in flat mode) and
 *   writes `field` = 'cover'|'contain'. `fallback` seeds the initial mode from a
 *   slide-level default when the per-image field is empty. Function-valued
 *   fallback, so core-map only.
 * @property {string[]} [formText]
 * @property {{selector:string, afterWrite?:(slide:Object)=>void}} [icons]
 * @property {{addMedia?:{toType:string, anchors:Array<Object>}, removeMedia?:{toType:string, selector:string}}} [convert]
 */

import { SLIDE_TYPE_INLINE_EDIT } from '../../../../shared/slide-types/inline-edit.js';

// This map is no longer hand-maintained here. Every core type declares its
// descriptor in `shared/slide-types/types/<name>/inline-edit.js`, and the map
// below is derived from the aggregator in shared/slide-types/inline-edit.js —
// the same seam as the picker's schematic and sample-content maps. Adding or
// retiring a type touches the type's own directory, not this file. The grammar
// the descriptors follow is documented in the block comment above; the shared
// header vocabulary (HEADER_GHOSTS / HEADER_TEXT) lives in
// shared/slide-types/inline-edit-common.js so a type's descriptor can build on
// it without importing this file back (which would be a cycle).

/** @type {Record<string, InlineDescriptor>} */
export const INLINE_DESCRIPTORS = { ...SLIDE_TYPE_INLINE_EDIT };

/**
 * Resolve the inline descriptor for a slide type. The core map wins; a type
 * without a core entry falls back to an `inline` descriptor declared on the
 * slide-type definition itself. That is the extension seam for custom slide
 * types (custom/slide-types/*.js in forks): declare `inline: { ghosts, cards,
 * formText, ... }` on the definition and it arrives here via /api/slide-types
 * - no core file needs editing. Same seam philosophy as the MCP custom-tools
 * hook. Note a definition-declared descriptor is JSON, so function-valued
 * options (addPlacement as a function) are core-map-only.
 *
 * ## Why core first, against the aggregator-seam rule
 *
 * Every other companion resolves definition-first (slideTypeInspectorKeeps,
 * slideTypeGroup, …): the definition as it exists at runtime is asked before
 * core's generated aggregator. This one is deliberately the other way round,
 * and it is the seam rule's one documented exception - see
 * docs/reference/slide-type-directory.md, "The one exception: the inline
 * descriptor".
 *
 * A descriptor is not a fact about the type, it is a description of the DOM the
 * type's renderer emits: `.title`, `.tsu-content`, `data-inline-field="meta"`.
 * So it has to agree with whichever renderer actually drew the slide, and in
 * the browser that is not always the fork's. `custom/slide-types/` is loaded by
 * node only (registry.js gates on `isNode`) and is not on the static allowlist
 * (server/config/paths.js serves `custom/assets/` and `custom/themes/`, not
 * `custom/slide-types/`), so a fork type that overrides a CORE NAME is still
 * bundled under that name client-side - `isBundledSlideType()` in
 * client/lib/slide-runtime/slide-render.js finds core's entry and renders
 * core's markup. Reading `def.inline` first would then point every ghost anchor
 * and every formText key at elements that are not in the document.
 *
 * A fork type with a NEW name is not bundled, gets server-rendered (the fork's
 * own markup), and has no core entry - so the fallback below fires and the seam
 * works exactly where the fork's renderer is the one that drew the slide.
 * Net: this lookup is renderer-first, and in the browser the renderer
 * precedence happens to be core-first. Flip it the day an override type's
 * renderer reaches the browser, not before.
 *
 * @param {string} type
 * @param {Object} [def] - slide-type definition (SLIDE_TYPES[type] / API meta)
 * @returns {InlineDescriptor | null}
 */
export function getInlineDescriptor(type, def) {
  const custom = def?.inline;
  return (
    INLINE_DESCRIPTORS[type] ||
    (custom && typeof custom === 'object' ? custom : null)
  );
}

/**
 * Side-form field keys fully covered by the inline layer for this type.
 * Empty for types without inline editing.
 * @param {string} type
 * @param {Object} [def] - slide-type definition, for the custom-type fallback
 * @returns {string[]}
 */
export function getInlineFormTextKeys(type, def) {
  const d = getInlineDescriptor(type, def);
  return Array.isArray(d?.formText) ? d.formText : [];
}
