/**
 * `defaultFromOption` — a blank string that stands in for its sibling enum's
 * chosen option, in the deck's language (D130c).
 *
 * A callout with no label still announces its kind: the canvas eyebrow says
 * "Key insight" (or "Kernpunt"). The reader used to say nothing, and named the
 * section after the type ("Callout"), because the word lived only in the
 * renderer. The declaration moves it to the definition, where every surface
 * reads it:
 *
 *     { key: 'variant', type: 'enum', options: [{ value, label, copyKey }] }
 *     { key: 'label', type: 'string', defaultFromOption: 'variant' }
 *
 * The word is the option's `copyKey` looked up in the slide copy
 * (`slide-copy.js`), the same table the canvas reads, so it follows the deck's
 * language rather than the editor's. There is one way to supply it: an option
 * without a `copyKey` gives no default, and the field walk says so beside the
 * declaration (`default_from_option_without_copy`). The option's `label` is
 * editor copy in the UI language and never stands in.
 *
 * @module shared/slide-types/option-default
 */

import { SLIDE_COPY, getSlideCopy } from './slide-copy.js';

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Does every language the slide copy carries know this key?
 * @param {unknown} copyKey
 * @returns {boolean}
 */
export function isSlideCopyKey(copyKey) {
  if (!str(copyKey)) return false;
  return Object.values(SLIDE_COPY).every(
    (table) => typeof table[copyKey] === 'string' && table[copyKey].trim(),
  );
}

/**
 * The text a blank `defaultFromOption` field stands in with, or `''`.
 *
 * @param {{defaultFromOption?: string}} field - the string field
 * @param {Array<object>} siblings - the fields declared beside it (same level)
 * @param {object} content - the object those fields describe
 * @param {object} [defaults] - that object's declared defaults
 * @param {string} [lang] - the deck language
 * @returns {string}
 */
export function optionDefaultText(field, siblings, content, defaults, lang) {
  const enumKey = str(field?.defaultFromOption);
  if (!enumKey) return '';
  const target = (Array.isArray(siblings) ? siblings : []).find(
    (f) => f?.key === enumKey && f.type === 'enum',
  );
  if (!target) return '';
  const value = str(content?.[enumKey]) || str(defaults?.[enumKey]);
  const option = (Array.isArray(target.options) ? target.options : []).find(
    (o) => o && typeof o === 'object' && String(o.value) === value,
  );
  if (!isSlideCopyKey(option?.copyKey)) return '';
  return str(getSlideCopy(lang)[option.copyKey]);
}
