import { normalizeLang, normalizeTranslationLang, ALL_TRANSLATION_LANGS } from '../../../shared/i18n-utils.js';

export { normalizeLang, normalizeTranslationLang, ALL_TRANSLATION_LANGS };

/**
 * Language labels for LLM translation prompts.
 * Uses full language names for clarity in AI prompts.
 */
const LANG_LABELS = {
  'nl': 'DUTCH',
  'en-GB': 'BRITISH ENGLISH',
  'en': 'BRITISH ENGLISH',
  'de': 'GERMAN',
  'fr': 'FRENCH',
  'es': 'SPANISH',
  'pt': 'PORTUGUESE',
  'it': 'ITALIAN',
  'pl': 'POLISH',
  'fi': 'FINNISH',
  'da': 'DANISH',
  'sv': 'SWEDISH',
  'no': 'NORWEGIAN',
};

export function labelForLang(v) {
  return LANG_LABELS[v] || 'UNKNOWN';
}

export function detectDeckLanguage(rawContent) {
  const s = String(rawContent || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');

  // Very small heuristic: count common stopwords.
  // Purpose: prevent accidental Dutch output for English input (e.g. due to UI language or € signs).
  const en = [
    'the',
    'and',
    'of',
    'to',
    'in',
    'for',
    'with',
    'by',
    'on',
    'as',
    'that',
    'this',
    'it',
    'from',
    'are',
    'is',
    'become',
    'known',
    'known for',
  ];
  const nl = [
    'de',
    'het',
    'een',
    'van',
    'voor',
    'met',
    'door',
    'op',
    'naar',
    'zijn',
    'worden',
    'bekend',
    'bekend om',
    'als',
    'dat',
    'dit',
  ];

  const countHits = (phrases) => {
    let c = 0;
    for (const p of phrases) {
      const re = new RegExp(
        `\\b${p.replace(/\s+/g, '\\s+')}\\b`,
        'g'
      );
      const m = s.match(re);
      if (m) c += m.length;
    }
    return c;
  };

  const enScore = countHits(en);
  const nlScore = countHits(nl);

  if (nlScore > enScore) return { code: 'nl', label: 'DUTCH' };
  return { code: 'en', label: 'ENGLISH' };
}
