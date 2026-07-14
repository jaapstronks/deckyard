import { normalizeLang, otherLang } from '../../shared/i18n-utils.js';
import { pickVersion } from './translation-status.js';

export { normalizeLang, otherLang };

export function hasLangVersion(pres, lang) {
  const l = normalizeLang(lang);
  if (!l) return false;
  return !!(
    pres?.i18n?.versions &&
    typeof pres.i18n.versions === 'object' &&
    pres.i18n.versions?.[l]
  );
}

export function resolveLangModeFromPresOrUrl(pres, url) {
  const q = normalizeLang(url?.searchParams?.get('lang'));
  if (q) return q;
  const a = normalizeLang(pres?.i18n?.active);
  if (a) return a;
  const d = normalizeLang(pres?.i18n?.dominant);
  if (d) return d;
  const p = normalizeLang(pres?.lang);
  if (p) return p;
  return 'nl';
}

export function projectPresentationForLang(pres, lang) {
  const l = normalizeLang(lang);
  if (!l) return pres;
  const v = pickVersion(pres, l);
  return {
    ...pres,
    lang: l,
    title: v.title || pres.title,
    slides:
      Array.isArray(v.slides) && v.slides.length ? v.slides : pres.slides,
    i18n: {
      ...(pres?.i18n && typeof pres.i18n === 'object' ? pres.i18n : {}),
      active: l,
      dominant: l,
    },
  };
}
