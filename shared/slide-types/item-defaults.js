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
 */

/**
 * @param {Object} field - a `type: 'items'` field schema
 * @param {string|null} [lang] - deck language (`resolveDeckLang(pres)`)
 * @returns {Object} the new-item skeleton for that language (not a clone —
 *   callers must `structuredClone` before pushing, as they already do)
 */
export function resolveItemDefaults(field, lang) {
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
