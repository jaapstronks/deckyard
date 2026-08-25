/**
 * The text-field vocabulary: which slide-type fields hold prose a human wrote,
 * and what follows from that.
 *
 * Eight modules used to carry this rule between them, in eleven separate
 * predicate expressions — the collab codec, the server translate pipeline, the
 * translation-status reader, the storage i18n facade, the deck coercion pass,
 * the AI description builder and two editor modules — and they disagreed in
 * three ways: whether `hidden` fields count, whether `csv` counts inside an
 * items field, and whether items are walked at all.
 * The disagreement was not cosmetic: the collab codec treated `hidden` as
 * "machine value, one per deck", which collapsed `text-blocks-slide`'s
 * numbered mirror of translatable prose to the dominant language on the first
 * collab edit, silently destroying the other language.
 *
 * The rule, stated once:
 *
 * - A field is a **text field** when its `type` is `string`, `markdown` or
 *   `csv`, at every nesting level. Those are the three types whose value is
 *   prose.
 * - `boolean`, `code`, `enum`, `image`, `link` and `number` are not, because
 *   their value is a machine token, a path or a number.
 * - `items` fields are walked recursively; their `itemFields` follow the same
 *   rule.
 * - **A text field is translatable, and nothing else is.** Translation is a
 *   consequence of the type, not a second classification.
 * - `hidden` is deliberately **not** consulted. It answers "does the inspector
 *   show this field", which is a different question from "is this text a human
 *   wrote". Every hidden text field in the registry today is a legacy mirror
 *   of prose.
 *
 * `tests/text-field-vocabulary-gate.test.js` keeps copy number nine from
 * growing back.
 *
 * @module shared/slide-types/text-fields
 */

// Imported from the registry rather than the `shared/slide-types.js` barrel:
// `deck.js` is a text-field consumer and the barrel re-exports it, so going
// through the barrel would make this module part of an import cycle.
import { SLIDE_TYPES } from './registry.js';

/** Field types whose value is prose, and therefore per-language. */
export const TEXT_FIELD_TYPES = Object.freeze(['string', 'markdown', 'csv']);

const TEXT_TYPE_SET = new Set(TEXT_FIELD_TYPES);

/**
 * Whether a field descriptor holds prose (and is therefore translatable).
 * @param {Object} field - Field descriptor from a slide type's `fields`
 * @returns {boolean}
 */
export function isTextField(field) {
  return TEXT_TYPE_SET.has(field?.type);
}

function fieldKey(field) {
  return typeof field?.key === 'string' ? field.key.trim() : '';
}

/**
 * Build the text spec for a list of field descriptors, recursively:
 * `{ textKeys: Set<string>, items: Map<fieldKey, spec> }`.
 * @param {Object[]} fields - Field descriptors
 * @returns {{textKeys: Set<string>, items: Map<string, Object>}}
 */
export function textFieldSpec(fields) {
  const spec = { textKeys: new Set(), items: new Map() };
  for (const f of Array.isArray(fields) ? fields : []) {
    const key = fieldKey(f);
    if (!key) continue;
    if (isTextField(f)) spec.textKeys.add(key);
    else if (f.type === 'items' && Array.isArray(f.itemFields))
      spec.items.set(key, textFieldSpec(f.itemFields));
  }
  return spec;
}

/**
 * Spec for a type with no fields: every value is plain. A fresh object each
 * time — a shared singleton would hand the same mutable `Set` and `Map` to
 * every unknown type, and `Object.freeze` on the wrapper would not protect
 * them.
 * @returns {{textKeys: Set<string>, items: Map<string, Object>}}
 */
export function emptyTextFieldSpec() {
  return { textKeys: new Set(), items: new Map() };
}

/**
 * Text spec for a slide type (recursive over items fields). Unknown types get
 * an empty spec: every field is treated as plain.
 * @param {string} type - Slide type name
 * @param {Object} [slideTypes] - Slide-type registry (forks/tests override)
 * @returns {{textKeys: Set<string>, items: Map<string, Object>}}
 */
export function textFieldSpecForType(type, slideTypes = SLIDE_TYPES) {
  const def = slideTypes?.[type];
  if (!def || !Array.isArray(def.fields)) return emptyTextFieldSpec();
  return textFieldSpec(def.fields);
}

/**
 * Top-level translatable keys for a slide type.
 * @param {string} type - Slide type name
 * @param {Object} [slideTypes] - Slide-type registry (forks/tests override)
 * @returns {string[]}
 */
export function translatableKeysForType(type, slideTypes = SLIDE_TYPES) {
  return [...textFieldSpecForType(type, slideTypes).textKeys];
}

/**
 * Translatable per-item text keys for a type's `items` fields, as
 * `Map<fieldKey, string[]>`. Items fields with no text keys are omitted.
 * @param {string} type - Slide type name
 * @param {Object} [slideTypes] - Slide-type registry (forks/tests override)
 * @returns {Map<string, string[]>}
 */
export function translatableItemKeysForType(type, slideTypes = SLIDE_TYPES) {
  const map = new Map();
  for (const [key, spec] of textFieldSpecForType(type, slideTypes).items) {
    if (spec.textKeys.size) map.set(key, [...spec.textKeys]);
  }
  return map;
}
