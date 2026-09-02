/**
 * Shared i18n utilities for language normalization and toggling.
 * These are pure functions with no state dependencies.
 */

/**
 * The deck-language axis: every language a deck can be written, stored and
 * translated into. **One open list, one definition site** — decision D61.
 *
 * This is the **deck** axis, not the UI-locale axis. It is keyed `en-GB` (the
 * canonical spelling of English for a deck), while `client/i18n/manifest.json`
 * keys the interface locale `en`. The two lists happen to name the same twelve
 * languages today, but they answer different questions — "what can a deck be
 * written in" versus "what can the interface be shown in" — so this one is
 * spelled out here rather than derived from the manifest.
 *
 * Until D61 the axis was a two-value enum (`['nl','en-GB']`) declared in five
 * places, with a sixth hardcode in `getLang()` and an accessor
 * (`client/lib/format/i18n.js`) whose setter filtered its own input back down
 * to that pair — an axis that advertised configurability and forbade it. The
 * `.deck` format already promises any BCP-47 tag
 * (`shared/slide-types/json-schema.js`), so the pair was a leftover, not a
 * contract. It is now this list, and only this list: nothing re-declares it,
 * and `normalizeLang()` is the only membership test.
 *
 * Everything that needs it (the storage facade, the public API, the LLM prompt
 * labels, the client accessor) derives from it;
 * `tests/deck-translation-langs.test.js` pins those derivations and
 * `tests/deck-language-axis.test.js` pins that there is one definition site.
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
 * English display names for the deck languages.
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
 * Native display names for the deck languages — what a picker shows.
 *
 * Sibling of `TRANSLATION_LANG_LABELS`: same keys, same axis, different reader.
 * The English map answers the public API and the LLM prompt ("translate into
 * Finnish"); this one answers a human choosing their own language, who expects
 * to read "Suomi". Both live here because both are keyed by the axis, and a
 * partial copy of this map in `client/lib/format/lang-selector.js` was missing
 * five of the twelve — those fell back to the raw code in the picker (D61).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TRANSLATION_LANG_NATIVE_LABELS = Object.freeze({
  nl: 'Nederlands',
  'en-GB': 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  pl: 'Polski',
  fi: 'Suomi',
  da: 'Dansk',
  sv: 'Svenska',
  no: 'Norsk',
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
 * The language a deck falls back to when nothing else names one.
 *
 * The first entry of the axis, not a second literal: "the default" and "the
 * axis" cannot drift apart if the default is read off the list. Every
 * `|| 'nl'` in the client and server used to answer this question privately
 * — ~40 of them, each free to disagree (D61).
 *
 * @type {string}
 */
export const DEFAULT_DECK_LANG = TRANSLATION_LANGS[0];

/**
 * The deck languages a fresh instance has switched on.
 *
 * The axis says what a deck *may* be written in; an instance decides which of
 * those its authors actually get (`appSettings.supportedSlideLangs`, admin
 * settings). This is the out-of-the-box answer, and it is deliberately narrower
 * than the axis: Deckyard ships bilingual NL/EN, and an instance that wants
 * Finnish switches it on. Both the server default and the client's
 * pre-boot value read it here, so "what is on by default" cannot differ
 * between the two sides (D61).
 *
 * @type {readonly string[]}
 */
export const DEFAULT_SUPPORTED_DECK_LANGS = Object.freeze(['nl', 'en-GB']);

/**
 * Normalize a value to a deck language, or null.
 *
 * The **one** membership test on the deck-language axis. Accepts every code in
 * `TRANSLATION_LANGS` plus the input aliases in `TRANSLATION_LANG_ALIASES`, and
 * returns the canonical spelling — so `en` comes back as `en-GB` and nothing is
 * ever stored under an alias.
 *
 * Until D61 this accepted `nl`/`en-GB` and nothing else, while a second
 * normalizer (`normalizeLang`) accepted all twelve: one axis, two
 * answers, depending on which import a module happened to reach for. They are
 * the same function now.
 *
 * @param {*} v - Language code to normalize
 * @returns {string|null} Canonical language code, or null when off-axis
 */
export function normalizeLang(v) {
  if (Object.hasOwn(TRANSLATION_LANG_ALIASES, v))
    return TRANSLATION_LANG_ALIASES[v];
  return TRANSLATION_LANG_SET.has(v) ? v : null;
}

/**
 * The native display name of a deck language — "Nederlands", "Deutsch".
 *
 * The one reader of `TRANSLATION_LANG_NATIVE_LABELS`, so every surface that
 * names a language names it the same way (D77): the editor's language menu,
 * the translate modals' source pill, the presenter switcher and — since the
 * viewer chrome stopped rendering a fixed `NL EN` pair (B182 fase 4) — the
 * published page and the embed. It lives here rather than in the client's
 * `lang-selector.js` because the server renders those last two.
 *
 * Falls back to the code itself for anything off-axis, so a label is never
 * empty.
 *
 * @param {*} code - a deck language code
 * @returns {string}
 */
export function getLangDisplayName(code) {
  return TRANSLATION_LANG_NATIVE_LABELS[normalizeLang(code) ?? code] || code;
}

/**
 * The language a translation into `to` should be read FROM.
 *
 * Every "the other language" question in the chrome is really this one, and it
 * has an answer for all twelve languages where the retired `otherLang()` had
 * one for two: the **dominant version is the source**, because it is the
 * version the deck is authored in and the only one guaranteed to be complete
 * (D72). Translating *into* the dominant version is the exception — there the
 * source is whatever version is being looked at, falling back to the first
 * other version the deck has.
 *
 * Returns null when the deck has nothing to translate from: no other version
 * exists, or the deck names no language at all. Callers must handle that rather
 * than translate a language into itself.
 *
 * @param {Object} [pres] - a presentation
 * @param {*} to - the language being translated into
 * @returns {string|null}
 */
export function translationSourceFor(pres, to) {
  const target = normalizeLang(to);
  const dominant =
    normalizeLang(pres?.i18n?.dominant) || normalizeLang(pres?.lang) || null;
  if (dominant && dominant !== target) return dominant;

  // Translating into the dominant version (or into nothing nameable): read from
  // the version on screen, else from the first other version the deck carries.
  const active = normalizeLang(pres?.i18n?.active);
  if (active && active !== target) return active;
  const versions =
    pres?.i18n?.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};
  for (const key of Object.keys(versions)) {
    if (!versions[key] || typeof versions[key] !== 'object') continue;
    const lang = normalizeLang(key);
    if (lang && lang !== target) return lang;
  }
  return null;
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
 * @returns {string|null}
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
