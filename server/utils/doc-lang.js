/**
 * RTL (Right-to-Left) language codes.
 * These languages render text from right to left.
 * - ar: Arabic
 * - he: Hebrew
 * - fa: Persian (Farsi)
 * - ur: Urdu
 */
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

/**
 * Normalize and validate a document language code.
 * Returns the language code if valid, null otherwise.
 * @param {string} v - Language code to validate
 * @returns {string|null} Normalized language code or null
 */
export function normalizeDocLang(v) {
  if (v === 'nl' || v === 'en-GB') return v;
  if (RTL_LANGS.has(v)) return v;
  return null;
}

/**
 * Get the document direction based on language code.
 * @param {string} lang - Language code
 * @returns {'rtl' | 'ltr'} Document direction
 */
export function getDocDir(lang) {
  return RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
}

// Resolve the language used for the HTML document (`<html lang="...">`).
// Preference order:
// - explicit deck-level `pres.lang`
// - i18n active/dominant (if present)
// - legacy heuristic based on slide-level `content.lang` (some older slide types use 'en'/'nl')
// - fallback: 'nl'
export function resolveDocLangFromPresentation(pres) {
  const direct = normalizeDocLang(pres?.lang);
  if (direct) return direct;

  const a = normalizeDocLang(pres?.i18n?.active);
  if (a) return a;
  const d = normalizeDocLang(pres?.i18n?.dominant);
  if (d) return d;

  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  for (const s of slides) {
    const v = s?.content?.lang;
    if (v === 'nl') return 'nl';
    if (v === 'en') return 'en-GB';
  }

  return 'nl';
}
