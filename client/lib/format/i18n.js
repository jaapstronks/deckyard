import { storage } from '../storage.js';
import { normalizeLang as sharedNormalizeLang } from '../../../shared/i18n-utils.js';

let supportedLangs = ['nl', 'en-GB'];
let supportedSet = new Set(supportedLangs);

export function getSupportedLangs() {
  return [...supportedLangs];
}

export function isSupportedLang(lang) {
  const l = normalizeLang(lang);
  return !!l && supportedSet.has(l);
}

export function setSupportedLangs(langs) {
  const next = [];
  for (const v of Array.isArray(langs) ? langs : []) {
    const s = v === 'nl' || v === 'en-GB' ? v : null;
    if (!s) continue;
    if (!next.includes(s)) next.push(s);
  }
  // Always keep at least one language enabled.
  if (!next.length) next.push('nl');
  supportedLangs = next;
  supportedSet = new Set(next);
}

export function normalizeLang(v) {
  return sharedNormalizeLang(v);
}

export function defaultLang() {
  return supportedLangs[0] || 'nl';
}

export function otherLang(lang) {
  const l = normalizeLang(lang);
  if (!l) return null;
  if (supportedLangs.length < 2) return null;
  // Foundation: only supports a 2-language toggle (NL <-> EN-GB).
  if (l === 'en-GB' && supportedSet.has('nl')) return 'nl';
  if (l === 'nl' && supportedSet.has('en-GB')) return 'en-GB';
  return null;
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
 * @returns {'nl'|'en-GB'|null}
 */
export function readStoredLangMode() {
  const raw = storage.get(LS_LANG_MODE, null);
  const normalized = normalizeLang(raw);
  return normalized && supportedSet.has(normalized) ? normalized : null;
}

export function readLangMode() {
  return readStoredLangMode() || defaultLang();
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
