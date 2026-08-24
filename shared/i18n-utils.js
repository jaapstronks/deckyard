/**
 * Shared i18n utilities for language normalization and toggling.
 * These are pure functions with no state dependencies.
 */

/**
 * The deck translation targets: every language a deck can be translated into.
 *
 * This is the **deck** axis, not the UI-locale axis. It is keyed `en-GB` (the
 * canonical spelling of English for a deck), while `client/i18n/manifest.json`
 * keys the interface locale `en`. The two lists happen to name the same twelve
 * languages today, but they answer different questions — "what can a deck be
 * translated into" versus "what can the interface be shown in" — so this one is
 * spelled out here rather than derived from the manifest.
 *
 * This array is the single source for that list. Everything else that needs it
 * (the storage facade, the public API, the LLM prompt labels) derives from it;
 * `tests/deck-translation-langs.test.js` pins those derivations.
 *
 * @type {readonly string[]}
 */
export const TRANSLATION_LANGS = Object.freeze([
  'nl', // Dutch
  'en-GB', // British English (canonical spelling of English on the deck axis)
  'de', // German
  'fr', // French
  'es', // Spanish
  'pt', // Portuguese
  'it', // Italian
  'pl', // Polish
  'fi', // Finnish
  'da', // Danish
  'sv', // Swedish
  'no', // Norwegian
]);

/**
 * English display names for the deck translation targets.
 *
 * One map, two readers: the public API returns these verbatim as the `label` of
 * a language, and the LLM prompt builder upper-cases them. Keys are exactly
 * `TRANSLATION_LANGS` — no aliases, no extras.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TRANSLATION_LANG_LABELS = Object.freeze({
  nl: 'Dutch',
  'en-GB': 'British English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  pl: 'Polish',
  fi: 'Finnish',
  da: 'Danish',
  sv: 'Swedish',
  no: 'Norwegian',
});

/**
 * Input aliases accepted on the deck axis, normalized away on the way in.
 *
 * `en` is the interface-locale spelling of English; callers that know Deckyard
 * from the UI side reach for it. It is accepted as *input* only — nothing is
 * ever stored or returned under an alias, so there is exactly one spelling of
 * English in the data.
 *
 * @type {Readonly<Record<string, string>>}
 */
const TRANSLATION_LANG_ALIASES = Object.freeze({ en: 'en-GB' });

const TRANSLATION_LANG_SET = new Set(TRANSLATION_LANGS);

/**
 * Legacy two-language set for presentation dominant/active language.
 * Used for backwards compatibility with existing presentations.
 */
const KNOWN_LANGS = new Set(['nl', 'en-GB']);

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
 * Normalize a language code to a deck translation target, or null.
 * Accepts every code in `TRANSLATION_LANGS` plus the aliases in
 * `TRANSLATION_LANG_ALIASES`; returns the canonical spelling.
 * @param {*} v - Language code to normalize
 * @returns {string|null} Canonical language code, or null when unsupported
 */
export function normalizeTranslationLang(v) {
  if (Object.hasOwn(TRANSLATION_LANG_ALIASES, v))
    return TRANSLATION_LANG_ALIASES[v];
  return TRANSLATION_LANG_SET.has(v) ? v : null;
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
