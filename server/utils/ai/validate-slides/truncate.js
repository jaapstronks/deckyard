/**
 * Text truncation.
 *
 * Bounds AI-generated text fields to their max lengths, cutting at a word
 * boundary where possible so slides don't show a half-word.
 *
 * The lengths come from the type's own `fields[]` — the same declaration strict
 * validation reads (D87). They used to come from a `MAX_LENGTHS` table plus a
 * hand-written walk over `items`/`members`/`metrics`/`rows` and the numbered
 * `row{N}Block{M}` mirror, which is how nineteen field places ended up bounded
 * at a length their definition disagreed with, and how a new type's fields were
 * not bounded at all. One walk over the declaration covers every collection a
 * type declares, however deeply.
 */

import { FIELD_TYPES } from '../../../../shared/slide-types/field-types.js';
import { logValidation } from './logging.js';

/**
 * Truncate a string to max length, adding ellipsis if needed
 */
function truncate(str, maxLen, fieldName = 'unknown') {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLen) return str;
  // Cut at a word boundary. A hard slice leaves a visible half-word on the
  // slide ("we apologize for the p"), which a presenter has to fix by hand.
  // Fall back to the hard cut when there is no sensible break point near the
  // limit, so a single very long token still gets bounded.
  const hardCut = str.slice(0, maxLen - 3);
  const lastBreak = hardCut.search(/\s\S*$/);
  const body = lastBreak > maxLen * 0.6 ? hardCut.slice(0, lastBreak) : hardCut;
  const truncated = `${body.replace(/[\s,;:.–—-]+$/, '')}...`;
  logValidation('truncate-field', {
    field: fieldName,
    originalLength: str.length,
    maxLength: maxLen,
    preview: str.slice(0, 50) + (str.length > 50 ? '...' : ''),
  });
  return truncated;
}

/** A declared cap, or null when the field states none. */
function capOf(field) {
  const max = Number(field?.maxLength);
  return Number.isFinite(max) && max > 0 ? max : null;
}

/**
 * Bound one level of content against the fields that declare it, recursing into
 * every `items` collection. Returns a new object; the input is not mutated.
 *
 * @param {Object} content - the content (or one item of a collection)
 * @param {Array<Object>} fields - the field descriptors for this level
 * @param {string} path - dotted path prefix, for the truncation log
 * @returns {Object}
 */
function boundLevel(content, fields, path) {
  if (!content || typeof content !== 'object') return content;
  const out = { ...content };

  for (const field of Array.isArray(fields) ? fields : []) {
    const key = typeof field?.key === 'string' ? field.key : '';
    if (!key || !(key in out)) continue;
    const at = path ? `${path}.${key}` : key;

    if (FIELD_TYPES[field.type]?.valueKind === 'objectArray') {
      if (!Array.isArray(out[key])) continue;
      out[key] = out[key].map((item, idx) =>
        boundLevel(item, field.itemFields, `${at}[${idx}]`),
      );
      continue;
    }

    const cap = capOf(field);
    if (cap && typeof out[key] === 'string') {
      out[key] = truncate(out[key], cap, at);
    }
  }

  return out;
}

/**
 * Truncate every text field in content to the max length its type declares.
 *
 * @param {Object|undefined} def - the composed slide-type definition
 * @param {Object} content
 * @returns {Object} a bounded copy (the input is untouched)
 */
export function truncateContentFields(def, content) {
  if (!content || typeof content !== 'object') return content;
  return boundLevel(content, def?.fields, '');
}
