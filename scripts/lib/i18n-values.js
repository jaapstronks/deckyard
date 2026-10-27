/**
 * The rules a single translated value must meet, whatever writes it.
 *
 * `tests/i18n-coverage.test.js` gates them over every locale on disk; the
 * reviewed import in `i18n-fill.js` checks the same rules *before* it writes, so
 * a package that would turn the suite red is refused instead of landing half
 * applied. One spelling of each rule, read by both.
 *
 * @module scripts/lib/i18n-values
 */

import { tierOf } from './i18n-locales.js';

/**
 * The `{var}` placeholder names in a string, sorted — what a translation has
 * to carry over from its English source, no more and no fewer.
 * @param {string} s
 * @returns {string[]}
 */
export function placeholderNames(s) {
  return [...String(s).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((m) => m[1])
    .sort();
}

/**
 * Why a value may not stand as `locale`'s translation of `english`, or an
 * empty list when it may.
 *
 * - a non-string or blank value renders nothing, where absence would have
 *   fallen back to the English;
 * - a dropped or invented `{var}` renders literally or loses its value;
 * - a Tier-2 value byte-identical to the English is a carbon copy, and since
 *   D73 "not translated yet" is written as absence (`nl` is Tier 1, where an
 *   English-equal word can be real Dutch).
 *
 * @param {string} locale
 * @param {unknown} value
 * @param {string} english - the reference value for the same key
 * @returns {string[]}
 */
export function translationValueProblems(locale, value, english) {
  if (typeof value !== 'string') return ['value is not a string'];
  if (!value.trim()) return ['value is empty'];
  const problems = [];
  const want = placeholderNames(english).join(',');
  const have = placeholderNames(value).join(',');
  if (want !== have)
    problems.push(`placeholders {${have}} differ from English {${want}}`);
  if (tierOf(locale) === 2 && value === english)
    problems.push('value is a carbon copy of the English');
  return problems;
}
