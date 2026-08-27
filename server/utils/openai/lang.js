import {
  normalizeLang,
  TRANSLATION_LANG_LABELS,
} from '../../../shared/i18n-utils.js';

export { normalizeLang };

/**
 * Language label for LLM translation prompts: the shared English name, upper-cased
 * for emphasis in the prompt. Aliases (`en`) resolve to their canonical code first.
 * @param {*} v - Language code
 * @returns {string} Upper-cased language name, or 'UNKNOWN'
 */
export function labelForLang(v) {
  const code = normalizeLang(v);
  return code ? TRANSLATION_LANG_LABELS[code].toUpperCase() : 'UNKNOWN';
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
      const re = new RegExp(`\\b${p.replace(/\s+/g, '\\s+')}\\b`, 'g');
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
