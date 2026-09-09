/**
 * Per-language resolution of a slide type's content defaults — the type-level
 * twin of `item-defaults.js`, which does the same for a collection field's
 * new-item skeleton.
 *
 * A type declares `defaults` (the neutral skeleton) and may declare
 * `defaultsByLang` holding complete per-language variants keyed by deck
 * language (`nl`, `'en-GB'`). A language with no entry — and a deck language
 * off that axis — falls back to `defaults`, so a type that reads the same in
 * every language declares nothing.
 *
 * One resolver because two surfaces ask the question and must not drift: the
 * slide factory (`newSlide`, where a slide comes into being) and the type
 * converter (`convert.js`, where an existing slide is re-seeded for its new
 * type). They used to carry the same nested `typeof` ladder twice, spelled
 * slightly differently.
 */

/**
 * A clone of the type's defaults for a deck language, ready to be mutated by
 * the caller.
 *
 * @param {{defaults?: Object, defaultsByLang?: Object}|null|undefined} def -
 *   a slide-type definition (registry entry, or the `/api/slide-types`
 *   metadata the editor holds)
 * @param {string|null} [lang] - deck language, already normalized
 *   (`normalizeLang`); anything falsy or off-axis takes `defaults`
 * @returns {Object} a fresh object — never a reference into the definition
 */
export function resolveTypeDefaults(def, lang) {
  const byLang = def?.defaultsByLang;
  const langDefaults =
    typeof lang === 'string' &&
    lang &&
    byLang &&
    typeof byLang === 'object' &&
    byLang[lang] &&
    typeof byLang[lang] === 'object'
      ? byLang[lang]
      : null;
  return structuredClone(langDefaults || def?.defaults || {});
}
