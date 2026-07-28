/**
 * Shared i18n utilities for language normalization and toggling.
 * These are pure functions with no state dependencies.
 */

/**
 * All supported language codes for translation.
 * Based on client/i18n/manifest.json locales.
 * Note: 'en' is normalized to 'en-GB' for backwards compatibility.
 */
export const ALL_TRANSLATION_LANGS = new Set([
  'nl',     // Dutch
  'en-GB',  // British English (canonical)
  'en',     // English (alias for en-GB)
  'de',     // German
  'fr',     // French
  'es',     // Spanish
  'pt',     // Portuguese
  'it',     // Italian
  'pl',     // Polish
  'fi',     // Finnish
  'da',     // Danish
  'sv',     // Swedish
  'no',     // Norwegian
]);

/**
 * Legacy two-language set for presentation dominant/active language.
 * Used for backwards compatibility with existing presentations.
 */
export const KNOWN_LANGS = new Set(['nl', 'en-GB']);

/**
 * Normalize a language code to a known presentation language or null.
 * Only accepts 'nl' or 'en-GB' (the two legacy presentation languages).
 * @param {*} v - Language code to normalize
 * @returns {'nl'|'en-GB'|null}
 */
export function normalizeLang(v) {
  return KNOWN_LANGS.has(v) ? v : null;
}

/**
 * Normalize a language code for translation.
 * Accepts all 12 supported languages plus 'en' (normalized to 'en-GB').
 * @param {*} v - Language code to normalize
 * @returns {string|null} Normalized language code or null
 */
export function normalizeTranslationLang(v) {
  if (!ALL_TRANSLATION_LANGS.has(v)) return null;
  // Normalize 'en' to 'en-GB' for consistency
  return v === 'en' ? 'en-GB' : v;
}

/**
 * Get the other language in a two-language system.
 * @param {*} lang - Current language
 * @returns {'nl'|'en-GB'}
 */
export function otherLang(lang) {
  return lang === 'en-GB' ? 'nl' : 'en-GB';
}

/**
 * The language a deck is written in, as far as the deck itself says.
 *
 * This is the ONE place that answers "what language is this deck", and its
 * result is what render callers pass to `renderSlideHtml` as `ctx.lang`. Every
 * slide type that shows built-in copy (poll, likert, feedback, timeline, chart,
 * gallery, …) reads that one value; none of them may re-derive a language of
 * their own. Six of them used to, with a literal `ctx?.lang || 'nl'`, which is
 * how an English deck ended up with Dutch poll copy: nothing ever set
 * `ctx.lang`, so the per-type fallback was the only thing that ran.
 *
 * `i18n.active` comes FIRST, and that ordering is load-bearing. `active` is the
 * language the deck is currently being shown in — the editor swaps `pres.slides`
 * to that version, and the toggle reads it — while `pres.lang` is the language
 * the deck was created in and never moves. A bilingual deck created in Dutch and
 * being read in English has `lang: 'nl'` and `active: 'en-GB'`; reading `lang`
 * first would put Dutch copy under English slides, which is the exact defect
 * this function exists to fix. `dominant` is the fallback for a deck with an
 * i18n block but no active choice; `lang` for one with no i18n block at all.
 *
 * Returns `null` when the deck names no language — deliberately, so the caller
 * cannot mistake "no answer" for a real one. `getSlideCopy()` turns that null
 * into `DEFAULT_SLIDE_COPY_LANG`.
 *
 * Note this is a narrower question than `<html lang>`, which also honours
 * legacy per-slide `content.lang` and RTL codes — see
 * `server/utils/doc-lang.js`.
 *
 * @param {Object} [pres] - a presentation
 * @returns {'nl'|'en-GB'|null}
 */
export function resolveDeckLang(pres) {
  return (
    normalizeLang(pres?.i18n?.active) ||
    normalizeLang(pres?.i18n?.dominant) ||
    normalizeLang(pres?.lang) ||
    null
  );
}

/**
 * Check if a value is a non-empty string.
 * @param {*} v - Value to check
 * @returns {boolean}
 */
export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}