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
 * Check if a value is a non-empty string.
 * @param {*} v - Value to check
 * @returns {boolean}
 */
export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}