/**
 * Per-language resolution of a collection field's new-item skeleton — the
 * item-level twin of the type-level `defaultsByLang` mechanism that
 * `makeNewSlide` reads for whole-slide defaults.
 *
 * An `items` field declares `itemDefaults` (the neutral skeleton, English)
 * and may declare `itemDefaultsByLang` holding complete per-language
 * variants keyed the same way as `defaultsByLang` (`nl`, `'en-GB'`). Only
 * languages whose skeleton differs from the neutral one need an entry —
 * every miss falls back to `itemDefaults`, so English types declare just
 * `nl`.
 *
 * Both add-item surfaces resolve through here — the generic collection
 * editor (side form) and the canvas inline editor's add button — so a new
 * item in an NL deck arrives in Dutch on either surface, and the two
 * cannot drift.
 *
 * A `tabular` field is the one skeleton that is not a declaration: a new row is
 * as wide as the table is at that moment, so it resolves from the sibling count
 * the field names in `columnCountKey` (./tabular.js).
 */
import { emptyTabularRow, tabularColumnCount } from './tabular.js';

/**
 * @param {Object} field - a `type: 'items'` field schema
 * @param {string|null} [lang] - deck language (`resolveDeckLang(pres)`)
 * @param {Object} [content] - the slide content, for fields whose skeleton
 *   depends on a sibling key (a `tabular` field's column count).
 * @param {Object} [typeDefaults] - the type's language-less `defaults`, where a
 *   tabular field's count lives when `content` has none (./tabular.js).
 * @returns {Object} the new-item skeleton for that language (not a clone —
 *   callers must `structuredClone` before pushing, as they already do)
 */
export function resolveItemDefaults(field, lang, content, typeDefaults) {
  // A tabular field's new row is as wide as the table is right now, so its
  // skeleton cannot be a static declaration — it reads the sibling count the
  // field itself names (`columnCountKey`). Declared, not branched on by type
  // name, so a fork's tabular type resolves the same way.
  if (field?.columnCountKey) {
    const maxCols = Array.isArray(field.itemFields)
      ? field.itemFields.length
      : 1;
    return emptyTabularRow(
      tabularColumnCount(content, {
        columnCountKey: field.columnCountKey,
        maxCols,
        defaults: typeDefaults,
      }),
    );
  }
  const byLang = field?.itemDefaultsByLang;
  const langDefaults =
    typeof lang === 'string' &&
    byLang &&
    typeof byLang === 'object' &&
    byLang[lang] &&
    typeof byLang[lang] === 'object'
      ? byLang[lang]
      : null;
  const base =
    field?.itemDefaults && typeof field.itemDefaults === 'object'
      ? field.itemDefaults
      : {};
  return langDefaults || base;
}
