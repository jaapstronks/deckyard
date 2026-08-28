import { storage } from '../storage.js';
import { queryString } from '../state/router.js';
import {
  DEFAULT_DECK_LANG,
  DEFAULT_SUPPORTED_DECK_LANGS,
  normalizeLang as sharedNormalizeLang,
  otherLang as sharedOtherLang,
} from '../../../shared/i18n-utils.js';

/**
 * The workspace's enabled subset of the deck-language axis.
 *
 * The axis itself is `TRANSLATION_LANGS` in `shared/i18n-utils.js`; this module
 * holds which of those an instance has switched on, pushed in at boot from
 * `appSettings.supportedSlideLangs` (`client/app.js`). Before D61 the setter
 * below filtered its own input down to `nl`/`en-GB`, so
 * `setSupportedLangs(['de','fr'])` produced an empty list and the
 * configurability this module advertises never worked.
 *
 * @type {string[]}
 */
let supportedLangs = [...DEFAULT_SUPPORTED_DECK_LANGS];
let supportedSet = new Set(supportedLangs);

export function getSupportedLangs() {
  return [...supportedLangs];
}

export function isSupportedLang(lang) {
  const l = normalizeLang(lang);
  return !!l && supportedSet.has(l);
}

/**
 * Replace the enabled subset. Values are normalized against the axis, so an
 * off-axis code is dropped rather than stored; an empty result falls back to
 * the axis default so the workspace always has one language.
 * @param {string[]} langs
 */
export function setSupportedLangs(langs) {
  const next = [];
  for (const v of Array.isArray(langs) ? langs : []) {
    const s = normalizeLang(v);
    if (!s) continue;
    if (!next.includes(s)) next.push(s);
  }
  // Always keep at least one language enabled.
  if (!next.length) next.push(DEFAULT_DECK_LANG);
  supportedLangs = next;
  supportedSet = new Set(next);
}

export function normalizeLang(v) {
  return sharedNormalizeLang(v);
}

export function defaultLang() {
  return supportedLangs[0] || DEFAULT_DECK_LANG;
}

/**
 * The other language of a bilingual workspace, or null — the enabled-subset
 * view of `otherLang()` in `shared/i18n-utils.js`. Null whenever the pair
 * cannot be named: fewer than two languages enabled, an off-axis input, or a
 * language outside the NL/EN pair the bilingual editor chrome is built on
 * (B182).
 * @param {*} lang
 * @returns {string|null}
 */
export function otherLang(lang) {
  const l = normalizeLang(lang);
  if (!l) return null;
  if (supportedLangs.length < 2) return null;
  const other = sharedOtherLang(l);
  return other && supportedSet.has(other) ? other : null;
}

export function hasLangVersion(pres, lang) {
  const l = normalizeLang(lang);
  if (!l) return false;
  return !!(
    pres?.i18n?.versions &&
    typeof pres.i18n.versions === 'object' &&
    pres.i18n.versions?.[l]
  );
}

const LS_LANG_MODE = 'app.langMode';

/**
 * The stored deck-language preference, or null when the user has never made
 * one (or the stored value is no longer supported).
 *
 * Distinct from `readLangMode()`, which always resolves to a language: a
 * caller that wants to derive a default from somewhere else (e.g. the UI
 * locale) must be able to tell "no preference" apart from "prefers nl".
 * @returns {string|null}
 */
export function readStoredLangMode() {
  const raw = storage.get(LS_LANG_MODE, null);
  const normalized = normalizeLang(raw);
  return normalized && supportedSet.has(normalized) ? normalized : null;
}

export function readLangMode() {
  return readStoredLangMode() || defaultLang();
}

// The query-string key that carries a **deck** language. `?lang=` is the oldest
// spelling and it travels inside shared editor/presenter/follow links, so it
// keeps the deck axis; the UI locale moved to `?locale=` (D61, see
// `client/lib/ui-i18n.js`) because one key answering two vocabularies meant a
// shared `?lang=nl` link silently switched the recipient's whole interface.
const DECK_LANG_PARAM_KEY = 'lang';

/**
 * Read a deck language off a URL query string, normalized against the axis.
 *
 * The one reader of `?lang=` on the client: every view that used to call
 * `url.searchParams.get('lang')` and re-validate it inline (presenter, viewer,
 * editor, follow — each with its own spelling of the check) goes through here,
 * so "is this a deck language" has one answer.
 *
 * @param {URL|string} [source] - a URL, a query string, or the current location
 * @returns {string|null}
 */
export function readDeckLangParam(source) {
  let qs = source;
  if (qs instanceof URL) qs = qs.search;
  if (qs == null) qs = queryString();
  let params;
  try {
    params = new URLSearchParams(qs || '');
  } catch {
    return null;
  }
  return normalizeLang(params.get(DECK_LANG_PARAM_KEY));
}

/**
 * The `?lang=…` suffix to append to an API or route URL, or `''` when the
 * source names no valid deck language.
 *
 * The presenter, the projector window and both editor entry points each built
 * this string inline from their own copy of the validity check; they now share
 * this one so a link cannot carry a language the reader would reject.
 *
 * @param {URL|string} [source] - a URL, a query string, or the current location
 * @returns {string}
 */
export function deckLangQuery(source) {
  const lang = readDeckLangParam(source);
  return lang ? `?${DECK_LANG_PARAM_KEY}=${encodeURIComponent(lang)}` : '';
}

/**
 * Map a UI locale onto a supported deck language, or null when none matches.
 * Matches the full tag first (case-insensitively), then the primary subtag —
 * so a UI locale of `en`, `en-GB` or `en-US` all land on the supported
 * `en-GB`, while `de` finds nothing in a NL/EN deck workspace.
 * @param {string} locale
 * @returns {string|null}
 */
export function langFromUiLocale(locale) {
  const tag = String(locale || '')
    .trim()
    .toLowerCase();
  if (!tag) return null;
  const exact = supportedLangs.find((l) => l.toLowerCase() === tag);
  if (exact) return exact;
  const base = tag.split('-')[0];
  return (
    supportedLangs.find((l) => l.toLowerCase().split('-')[0] === base) || null
  );
}

/**
 * The language a *new* deck should start in. Precedence, deliberately:
 *
 *   1. an explicitly stored preference (`readStoredLangMode()`)
 *   2. the current UI locale, mapped onto a supported deck language
 *   3. the workspace's first supported language (`defaultLang()`)
 *
 * A saved choice outranks the locale so that someone who once picked NL keeps
 * getting NL, even when they read the app in English. Only in the absence of
 * such a choice — the anonymous sandbox visitor arriving at `?lang=en` being
 * the motivating case — does the UI locale decide.
 *
 * Pure by design: both inputs are passed in, so the precedence is testable
 * without localStorage.
 * @param {Object} [sources]
 * @param {string|null} [sources.storedLang] - result of `readStoredLangMode()`
 * @param {string|null} [sources.uiLocale] - result of `getUiLocale()`
 * @returns {string}
 */
export function resolveInitialDeckLang({ storedLang, uiLocale } = {}) {
  const stored = normalizeLang(storedLang);
  if (stored && supportedSet.has(stored)) return stored;
  return langFromUiLocale(uiLocale) || defaultLang();
}

export function writeLangMode(lang) {
  const l = normalizeLang(lang);
  if (!l) return;
  if (!supportedSet.has(l)) return;
  storage.set(LS_LANG_MODE, l);
}
