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
 * - The **walk** is shared, not just the vocabulary: `mapItemTexts` matches two
 *   language versions item by item at every level, so the translate merge, the
 *   editor's save-time language sync and the missing-translation scan cannot
 *   drift apart on how deep a text field may sit (B164 — they had, and
 *   `text-blocks-slide` `rows[].blocks[]` was never translated).
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
 * Value at a `['rows', 0, 'blocks', 1, 'title']` path inside a slide content
 * object. Missing links yield `undefined` rather than throwing, so a call site
 * can ask the other language for a path its version does not have yet.
 * @param {*} root - Object or array to read from
 * @param {Array<string|number>} path - Alternating keys and indices
 * @returns {*}
 */
export function valueAtPath(root, path) {
  let cur = root;
  for (const step of Array.isArray(path) ? path : []) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[step];
  }
  return cur;
}

/**
 * Rebuild one `items` array so every text field below it — at **any** nesting
 * depth — comes from `resolve`, while item count, order and all non-text
 * values follow `srcArr`.
 *
 * This is the one place the per-index match between two language versions is
 * made. It used to be spelled out per call site and only one level deep, so
 * `text-blocks-slide`'s `rows[].blocks[].title/body` was invisible to the
 * translate pipeline while the collab codec (`textFieldSpec`, two screens up)
 * already walked it recursively. One recursion, three callers.
 *
 * A read-only scan is the same walk: pass a `resolve` that records the path
 * and returns `undefined`, and discard the rebuilt array.
 *
 * @param {*} srcArr - Source-language array; decides item count and order
 * @param {{textKeys: Set<string>, items: Map<string, Object>}} spec - Spec for this items field
 * @param {Object} opts
 * @param {(path: Array<string|number>, srcValue: *) => (string|undefined)} opts.resolve -
 *   Value to write for one text field; `undefined` keeps what the base item
 *   already holds (the source value when no `base` was given)
 * @param {*} [opts.base] - Parallel array whose non-text values survive instead
 *   of the source's. Supplying it at all makes the base win: an item the base
 *   lacks starts empty, so a target version never inherits source-language prose.
 * @param {Array<string|number>} [opts.path] - Path of this array inside the slide content
 * @returns {Array}
 */
export function mapItemTexts(srcArr, spec, { resolve, base, path = [] } = {}) {
  const src = Array.isArray(srcArr) ? srcArr : [];
  const baseArr = Array.isArray(base) ? base : null;
  const hasBase = base !== undefined && base !== null;
  return src.map((srcItem, i) => {
    const srcObj = srcItem && typeof srcItem === 'object' ? srcItem : null;
    const baseObj =
      baseArr?.[i] && typeof baseArr[i] === 'object' ? baseArr[i] : null;
    // A primitive item carries no fields to match: hand it back untouched.
    if (!srcObj && !hasBase) return srcItem;
    const out = structuredClone(hasBase ? baseObj || {} : srcObj);
    const itemPath = [...path, i];
    for (const key of spec.textKeys) {
      const v = resolve([...itemPath, key], srcObj?.[key]);
      if (typeof v === 'string') out[key] = v;
    }
    for (const [key, sub] of spec.items) {
      if (!Array.isArray(srcObj?.[key])) continue;
      out[key] = mapItemTexts(srcObj[key], sub, {
        resolve,
        // `?? []` keeps "the base wins" true all the way down: a nested array
        // the base has not grown yet must still start empty, not inherit the
        // source language's prose.
        base: hasBase ? (baseObj?.[key] ?? []) : undefined,
        path: [...itemPath, key],
      });
    }
    return out;
  });
}

function itemsFieldsJson(spec) {
  const out = [];
  for (const [key, sub] of spec.items) {
    const itemKeys = [...sub.textKeys];
    const itemsFields = itemsFieldsJson(sub);
    // An items field with no prose anywhere below it has nothing to say.
    if (!itemKeys.length && !itemsFields.length) continue;
    const entry = { key, itemKeys };
    if (itemsFields.length) entry.itemsFields = itemsFields;
    out.push(entry);
  }
  return out;
}

/**
 * A type's translatable `items` fields as plain JSON, for prompts and wire
 * formats: `[{ key, itemKeys, itemsFields? }]`, recursive. `itemsFields` is
 * present only where a nested items field carries text, so the common flat
 * type keeps its flat shape.
 * @param {string} type - Slide type name
 * @param {Object} [slideTypes] - Slide-type registry (forks/tests override)
 * @returns {{key: string, itemKeys: string[], itemsFields?: Object[]}[]}
 */
export function translatableItemsFieldsForType(type, slideTypes = SLIDE_TYPES) {
  return itemsFieldsJson(textFieldSpecForType(type, slideTypes));
}
