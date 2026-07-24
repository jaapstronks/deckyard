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

export const LS_LANG_MODE = 'app.langMode';

export function readLangMode() {
  const raw = storage.get(LS_LANG_MODE, null);
  const normalized = normalizeLang(raw);
  return (supportedSet.has(normalized) ? normalized : null) || defaultLang();
}

export function writeLangMode(lang) {
  const l = normalizeLang(lang);
  if (!l) return;
  if (!supportedSet.has(l)) return;
  storage.set(LS_LANG_MODE, l);
}
