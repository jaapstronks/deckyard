/**
 * `semantic: true` on an enum — structure that hangs on a choice (D130b).
 *
 * An enum is presentational by default: `layout`, `fit` and `direction` say how
 * the canvas arranges content, and the reader drops them. Some enums say what
 * the content *is* instead: a callout's `variant` is the difference between a
 * warning and a tip, a matrix cell's `tone` is whether a quadrant is good or
 * bad news. Dropping those loses meaning a reader, a stylesheet or an agent
 * reading the HTML needs.
 *
 * The field declares it with `semantic: true`, the mirror of `presentational:
 * true` on a string. The value never becomes document text (it is a storage
 * token, not prose); it travels as a `data-<key>` attribute on the block the
 * field belongs to:
 *
 * - a top-level field → the slide's wrapper: the canvas root `.slide` (see
 *   `renderSlideHtml`) and the reader's `<section>`;
 * - an item field → that item's `<li>` in the reader. The canvas renders items
 *   in per-type markup, so there the type puts the attribute on its own item
 *   element (matrix-slide's `.matrix-cell` carries `data-tone`).
 *
 * One attribute name per key, derived and never declared: `variant` becomes
 * `data-variant`, a camelCase `asideVariant` becomes `data-aside-variant`
 * (HTML lower-cases attribute names, so the camelCase spelling would not
 * survive a parser). There is no second `data-variant` convention beside it.
 *
 * @see docs/developer/slide-types.md
 * @module shared/slide-types/semantic-enums
 */

import { enumOptionValues } from './field-types.js';
import { isFieldVisible } from './field-visibility.js';
import { escapeHtml } from './helpers.js';

/**
 * The `data-*` attribute name a semantic enum travels under.
 * @param {string} key - the field key
 * @returns {string} e.g. `data-variant`, `data-aside-variant`
 */
export function semanticDataAttrName(key) {
  return `data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Is this field a semantic enum?
 * @param {{type?: string, semantic?: unknown}} field
 * @returns {boolean}
 */
export function isSemanticEnum(field) {
  return field?.type === 'enum' && field.semantic === true;
}

/**
 * The value a semantic enum carries: the stored value when it is one of the
 * field's options, else the declared default when that is, else nothing.
 *
 * A stored value outside the options is not a meaning the type knows, so it is
 * not written into the HTML; the canvas renders such a value as the default,
 * and so does this. The default is the declared one at that level: the type's
 * `defaults` for a top-level field, the items field's `itemDefaults` skeleton
 * for an item field. Without one, an unset or unknown value carries nothing.
 *
 * @param {object} field - the enum field
 * @param {object} obj - the object the field lives in (content or one item)
 * @param {object} [defaults] - the declared defaults at that level (`defaults`
 *   or `itemDefaults`)
 * @returns {string} the value, or `''`
 */
export function semanticEnumValue(field, obj, defaults) {
  const offered = enumOptionValues(field);
  const stored = obj?.[field.key];
  if (typeof stored === 'string' && offered.includes(stored)) return stored;
  const fallback = defaults?.[field.key];
  if (typeof fallback === 'string' && offered.includes(fallback))
    return fallback;
  return '';
}

/**
 * The ` data-<key>="<value>"` attribute string for every semantic enum among
 * `fields` that is visible and carries a value. Leading space included, empty
 * when there is none, so it can be spliced straight into a start tag.
 *
 * @param {Array<object>} fields - `fields[]` or `itemFields[]`
 * @param {object} obj - the object those fields describe
 * @param {object} [defaults] - the declared defaults at that level: the type's
 *   `defaults`, or the items field's `itemDefaults`
 * @returns {string}
 */
export function semanticEnumAttrs(fields, obj, defaults) {
  let out = '';
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!isSemanticEnum(field) || field.hidden) continue;
    if (!isFieldVisible(field, obj, defaults || {})) continue;
    const value = semanticEnumValue(field, obj, defaults);
    if (!value) continue;
    out += ` ${semanticDataAttrName(field.key)}="${escapeHtml(value)}"`;
  }
  return out;
}
