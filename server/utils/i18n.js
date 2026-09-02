import { DEFAULT_DECK_LANG, normalizeLang } from '../../shared/i18n-utils.js';
import { pickVersion } from '../../shared/i18n-progress.js';

export { normalizeLang };

export function resolveLangModeFromPresOrUrl(pres, url) {
  const q = normalizeLang(url?.searchParams?.get('lang'));
  if (q) return q;
  const a = normalizeLang(pres?.i18n?.active);
  if (a) return a;
  const d = normalizeLang(pres?.i18n?.dominant);
  if (d) return d;
  const p = normalizeLang(pres?.lang);
  if (p) return p;
  return DEFAULT_DECK_LANG;
}

export function projectPresentationForLang(pres, lang) {
  const l = normalizeLang(lang);
  if (!l) return pres;
  const v = pickVersion(pres, l);
  return {
    ...pres,
    lang: l,
    title: v.title || pres.title,
    slides: Array.isArray(v.slides) && v.slides.length ? v.slides : pres.slides,
    // Only the language mode moves: `dominant` is the language the deck is
    // written in, and rendering a version does not change that (D74).
    i18n: {
      ...(pres?.i18n && typeof pres.i18n === 'object' ? pres.i18n : {}),
      active: l,
    },
  };
}
