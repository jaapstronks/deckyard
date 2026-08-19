/**
 * The editing companions, resolved — the `inline-edit.js` counterpart of
 * `./authoring-companions.js`.
 *
 * ## Why this lookup is not in the inspector
 *
 * `getInspectorKeepKeys()` used to read one hand-written map that lived beside
 * it in `client/views/editor/editor-form/inspector-form.js`, so "which fields
 * does the inspector keep for this type" had exactly one possible answer:
 * core's. A slide type from `custom/slide-types/` — the fork seam that already
 * carries `inline`, `schematic` and `sampleContent` — had no way to narrow its
 * own settings pane, and got the conservative fallback whether or not it had an
 * opinion.
 *
 * So the lookup follows the aggregator-seam rule the other companions follow
 * (docs/reference/slide-type-directory.md): the definition as it exists at
 * runtime is asked first, the generated aggregator is core's answer to it, and
 * a miss falls back rather than throwing. One lookup, in this module, so no
 * consumer writes its own precedence rule.
 *
 * The wire half matters as much as the order: the editor does not hold the
 * registry, it holds the `GET /api/slide-types` response, so `inspectorKeeps`
 * travels on that route or the definition-first branch is dead on arrival —
 * exactly the trap `schematic` and `sampleContent` were in until #473.
 *
 * @see docs/reference/slide-type-directory.md — the seam rule, written out.
 */

import {
  SLIDE_TYPE_ELEMENT_TAB,
  SLIDE_TYPE_INSPECTOR_KEEPS,
} from './inline-edit.js';

/**
 * The inspector keep-list for a type: which field keys the settings pane keeps
 * rendering even though the inline layer covers the rest of the slide.
 *
 * A *narrowing*, so the absence of a list is meaningful and distinct from an
 * empty one: `null` means "nobody narrowed this type, keep every field the
 * inline layer does not cover", while `[]` means "the canvas covers all of it".
 * Callers must not collapse the two.
 *
 * @param {string} type - registry type name
 * @param {{inspectorKeeps?: unknown}|null} [def] - the slide-type definition as
 *   it exists at runtime (registry entry, or the `/api/slide-types` metadata)
 * @returns {string[]|null} the keep-list, or null when neither side declares one
 */
export function slideTypeInspectorKeeps(type, def = null) {
  const declared = def?.inspectorKeeps;
  if (
    Array.isArray(declared) &&
    declared.every((key) => typeof key === 'string')
  ) {
    return declared;
  }
  const core = SLIDE_TYPE_INSPECTOR_KEEPS[type];
  return Array.isArray(core) ? core : null;
}

/**
 * The element-tab offer for a type: which kinds of canvas sub-element get their
 * own "This element" tab in the inspector, and how many of each.
 *
 * The grammar, one entry per selection kind (`image`, `card`) — three shapes,
 * because the seven types that offer a tab need exactly three answers:
 *
 *   { list: 'images' }   a tab per item of that content collection; the
 *                        collection's length is the bound
 *   { range: [min, max] } a fixed index window (image-slide's single image at
 *                        0, quote-slide's author portraits at 1-3)
 *   { any: true }        every index (image-text pads `images[]` to the
 *                        layout's cell count on demand, so a selection may
 *                        legitimately point past the stored items)
 *
 * Read through this function rather than off the map: the definition is asked
 * first, so a fork type declaring `elementTab` is heard — the same precedence
 * (and the same wire half on `GET /api/slide-types`) as
 * {@link slideTypeInspectorKeeps}.
 *
 * Absence is the common answer: a type that declares nothing offers no element
 * tab, and the caller falls back to the slide-level form.
 *
 * @param {string} type - registry type name
 * @param {{elementTab?: unknown}|null} [def] - the definition as it exists at
 *   runtime (registry entry, or the `/api/slide-types` metadata)
 * @returns {Object|null}
 */
export function slideTypeElementTab(type, def = null) {
  const declared = def?.elementTab;
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    return declared;
  }
  const core = SLIDE_TYPE_ELEMENT_TAB[type];
  return core && typeof core === 'object' ? core : null;
}

/**
 * Whether a selected element index falls inside what the type offers.
 *
 * The one implementation of the grammar above, so the editor never re-reads a
 * declaration's shape by hand.
 *
 * @param {Object|null|undefined} offer - one kind's entry from
 *   {@link slideTypeElementTab}
 * @param {Object} content - the slide's content, for a `list` bound
 * @param {number} idx - the selected index
 * @returns {boolean}
 */
export function elementTabOffersIndex(offer, content, idx) {
  if (!offer || typeof offer !== 'object') return false;
  if (!Number.isInteger(idx) || idx < 0) return false;
  if (offer.any === true) return true;
  if (typeof offer.list === 'string') {
    const items = content?.[offer.list];
    return Array.isArray(items) && idx < items.length;
  }
  if (Array.isArray(offer.range) && offer.range.length === 2) {
    const [min, max] = offer.range;
    return Number.isInteger(min) && Number.isInteger(max)
      ? idx >= min && idx <= max
      : false;
  }
  return false;
}
