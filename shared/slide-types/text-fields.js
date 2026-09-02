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
 * - For a key the type does **not** declare, the type cannot answer, so the
 *   **value** decides: a string is prose (per language), anything else is a
 *   machine value (one per deck). `normalizeSlides` deliberately lets unknown
 *   keys through — never throw data away — and this is what that passthrough
 *   means for translation (D79).
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
 * `{ textKeys: Set<string>, declaredKeys: Set<string>, items: Map<fieldKey, spec> }`.
 *
 * `declaredKeys` holds every key the level declares, whatever its type. It is
 * what lets `isPerLanguageKey` tell "declared, and not prose" apart from "not
 * declared at all" — two answers the text keys alone cannot distinguish.
 *
 * @param {Object[]} fields - Field descriptors
 * @returns {{textKeys: Set<string>, declaredKeys: Set<string>, items: Map<string, Object>}}
 */
export function textFieldSpec(fields) {
  const spec = {
    textKeys: new Set(),
    declaredKeys: new Set(),
    items: new Map(),
  };
  for (const f of Array.isArray(fields) ? fields : []) {
    const key = fieldKey(f);
    if (!key) continue;
    spec.declaredKeys.add(key);
    if (isTextField(f)) spec.textKeys.add(key);
    else if (f.type === 'items' && Array.isArray(f.itemFields))
      spec.items.set(key, textFieldSpec(f.itemFields));
  }
  return spec;
}

/**
 * Spec for a type with no fields: it declares nothing, so every stored key
 * falls to the value rule. A fresh object each time — a shared singleton would
 * hand the same mutable `Set` and `Map` to every unknown type, and
 * `Object.freeze` on the wrapper would not protect them.
 * @returns {{textKeys: Set<string>, declaredKeys: Set<string>, items: Map<string, Object>}}
 */
export function emptyTextFieldSpec() {
  return { textKeys: new Set(), declaredKeys: new Set(), items: new Map() };
}

/**
 * Is this stored content key per-language, given the values the deck's
 * language versions hold for it?
 *
 * Three cases, in order. A **declared text key** is prose because its type
 * says so. Any **other declared key** is a machine value — an enum, an image
 * path, a number — and `items` fields are declared too, because they are
 * walked rather than classified here. For an **undeclared** key the type
 * cannot answer, so the value does: an undeclared string is by construction a
 * remnant (a renamed key, a retired type, a hand-written deck) and every
 * measured class of it is prose, while machine values are the ones that *are*
 * declared. The asymmetry decides the tie: reading a machine string per
 * language costs nothing — every version holds the same value — while reading
 * prose per deck destroys a translation, so the fail-safe answer is "per
 * language" (D79, #1040).
 *
 * A key whose versions disagree on the *kind* of value is a machine value: a
 * number in one version and a string in another cannot both be prose, and
 * plain-value handling keeps the dominant version's value and warns.
 *
 * @param {{textKeys: Set<string>, declaredKeys: Set<string>}} spec - Text spec for this level
 * @param {string} key - Stored content key
 * @param {...*} values - The value each language version stores; `undefined` (the
 *   version does not have the key) is ignored
 * @returns {boolean}
 */
export function isPerLanguageKey(spec, key, ...values) {
  if (spec?.textKeys?.has(key)) return true;
  if (spec?.declaredKeys?.has(key)) return false;
  let seen = false;
  for (const v of values) {
    if (v === undefined) continue;
    if (typeof v !== 'string') return false;
    seen = true;
  }
  return seen;
}

/**
 * The per-language keys of one slide's content, read across every language
 * version that holds it: every declared text key, plus every undeclared key
 * whose stored value is prose by the rule above.
 *
 * Passing all versions at once is what keeps a version's own prose alive: an
 * undeclared string that exists *only* in a non-dominant version is still a
 * per-language key, and would be dropped by a classification that looked at
 * the dominant version alone.
 *
 * @param {{textKeys: Set<string>, declaredKeys: Set<string>}} spec - Text spec for this level
 * @param {...*} contents - One content (or item) object per language version
 * @returns {Set<string>}
 */
export function perLanguageKeys(spec, ...contents) {
  const objects = contents.filter((c) => c && typeof c === 'object');
  const keys = new Set(spec?.textKeys ?? []);
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      if (keys.has(key)) continue;
      if (isPerLanguageKey(spec, key, ...objects.map((o) => o[key])))
        keys.add(key);
    }
  }
  return keys;
}

/**
 * Text spec for a slide type (recursive over items fields). Unknown types get
 * an empty spec: they declare nothing, so every stored key falls to the value
 * rule.
 * @param {string} type - Slide type name
 * @param {Object} [slideTypes] - Slide-type registry (forks/tests override)
 * @returns {{textKeys: Set<string>, declaredKeys: Set<string>, items: Map<string, Object>}}
 */
export function textFieldSpecForType(type, slideTypes = SLIDE_TYPES) {
  const def = slideTypes?.[type];
  if (!def || !Array.isArray(def.fields)) return emptyTextFieldSpec();
  return textFieldSpec(def.fields);
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
 * Rebuild one `items` array so every per-language field below it — at **any**
 * nesting depth — comes from `resolve`, while item count, order and all
 * machine values follow `srcArr`.
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
    // The value rule reaches item level too: an item's keys are declared by
    // `itemFields`, so an undeclared string inside one is the same remnant the
    // slide level sees, and is prose for the same reason (D79).
    for (const key of perLanguageKeys(spec, srcObj, baseObj)) {
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
