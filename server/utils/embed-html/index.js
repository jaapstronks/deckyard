import { renderSlideHtml, computeHeadingShifts } from '../render-slide.js';
import {
  detectLang,
  escapeHtml,
  parseAllowedOriginsParam,
  parseBoolParam,
  parseUiParam,
  slideA11yLabel,
} from './helpers.js';
import { renderEmbedHtmlDocument } from './template.js';
import { filterForPublished } from '../public-output.js';
import { themeVarsCssText } from '../themes.js';
import {
  sandboxWatermarkCss,
  sandboxWatermarkEnabled,
  sandboxWatermarkHtml,
} from '../sandbox-watermark.js';
import { DEFAULT_THEME_ID } from '../../../shared/constants/themes.js';
import { resolveDocLangFromPresentation, getDocDir } from '../doc-lang.js';

export function buildEmbedHtml(
  repoRoot,
  pres,
  {
    publishId = '',
    theme = null,
    controls = true,
    start = 0,
    loop = false,
    ui = 'default',
    allowFullscreen = true,
    allowedOrigins = [],
    lang = null,
    hasOtherLang = false,
    langSwitch = false,
    headHtml = '',
    watermark = null,
    slideTypes = null,
  } = {}
) {
  pres = filterForPublished(pres);
  const themeId = String(theme?.id || DEFAULT_THEME_ID);
  const themeVarsCss = themeVarsCssText(theme);
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const title = pres?.title || 'Presentation';
  const docLang = detectLang(pres);
  // Direction is resolved from the deck's real language (pres.lang / i18n),
  // which — unlike detectLang's nl/en heuristic — can surface RTL locales
  // (ar/he/fa/ur). Parity with export/reader/print, which all set dir via getDocDir.
  const docDir = getDocDir(resolveDocLangFromPresentation(pres));
  const totalSlides = slides.length || 0;

  const wmOn = sandboxWatermarkEnabled(watermark);
  const wmCss = wmOn ? sandboxWatermarkCss() : '';
  const wmHtml = wmOn ? sandboxWatermarkHtml() : '';

  // The embed is a fragment (no document <h1> of its own — the host page owns
  // that), so slide titles stay at <h2>, dropping to <h3> inside a chapter
  // section. Same running-state model as the standalone export.
  const headingShifts = computeHeadingShifts(slides);
  const slidesHtml = slides
    .map((s, i) => {
      const label = escapeHtml(slideA11yLabel(s, i, totalSlides));
      const isFirst = i === 0;
      const inertAttr = isFirst ? '' : ' inert';
      const activeClass = isFirst ? ' is-active' : '';
      const ariaHidden = isFirst ? 'false' : 'true';
      let innerHtml = '';
      try {
        innerHtml = renderSlideHtml(s, { theme, slideTypes, stripEditorAttrs: true, headingShift: headingShifts[i] });
      } catch (e) {
        const msg = escapeHtml(String(e?.message || e));
        innerHtml = `
          <div class="slide slide-bg-mist">
            <div class="slide-inner">
              <div class="heading">Deze slide kan niet worden weergegeven</div>
              <div class="help" style="margin-top:12px; opacity:0.9;">${msg}</div>
            </div>
          </div>
        `;
      }
      return `<section id="slide-${i + 1}" class="deck-slide${activeClass}" data-slide-id="${escapeHtml(
        s.id
      )}" data-slide-index="${i}" role="group" aria-roledescription="slide" aria-label="${label}" aria-hidden="${ariaHidden}" tabindex="-1"${inertAttr}>${innerHtml}</section>`;
    })
    .join('\n');

  // Values used by the runtime script
  const boot = {
    publishId: String(publishId || ''),
    totalSlides,
    options: {
      controls: !!controls,
      loop: !!loop,
      start: Number(start || 0) || 0,
      ui: ui === 'min' ? 'min' : 'default',
      allowFullscreen: !!allowFullscreen,
      allowedOrigins: Array.isArray(allowedOrigins) ? allowedOrigins : [],
      langSwitch: !!langSwitch,
    },
    lang: lang === 'nl' || lang === 'en-GB' ? lang : null,
    hasOtherLang: !!hasOtherLang,
  };

  // Build external font link/script tags for managed fonts (Adobe, Monotype, Google)
  const externalFontLinks = Array.isArray(theme?.externalFontLinks) ? theme.externalFontLinks : [];
  function isSafeUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }
  const externalFontCssLinks = externalFontLinks
    .filter((l) => l.type === 'css' && l.url)
    .filter((l) => isSafeUrl(l.url))
    .map((l) => `<link rel="stylesheet" href="${l.url.replace(/"/g, '&quot;')}" />`)
    .join('\n    ');
  const externalFontScripts = externalFontLinks
    .filter((l) => l.type === 'js' && l.url)
    .filter((l) => isSafeUrl(l.url))
    .map((l) => `<script src="${l.url.replace(/"/g, '&quot;')}"></script>`)
    .join('\n    ');
  const externalFontHtml = [externalFontCssLinks, externalFontScripts].filter(Boolean).join('\n    ');

  return renderEmbedHtmlDocument({
    title,
    docLang,
    docDir,
    totalSlides,
    publishId,
    ui,
    slidesHtml,
    boot,
    themeId,
    themeVarsCss,
    headHtml,
    externalFontHtml,
    watermarkCss: wmCss,
    watermarkHtml: wmHtml,
  });
}

export function parseEmbedOptionsFromUrl(url) {
  const sp = url?.searchParams;
  const controls = parseBoolParam(sp?.get('controls'), true);
  const loop = parseBoolParam(sp?.get('loop'), false);
  const allowFullscreen = parseBoolParam(sp?.get('allowFullscreen'), true);
  const ui = parseUiParam(sp?.get('ui'), 'default');
  const langSwitch = parseBoolParam(sp?.get('langSwitch'), false);

  // start/slideIndex: both supported; prefer explicit start
  const startRaw = sp?.get('start') != null ? sp.get('start') : sp?.get('slideIndex');
  const start = Math.max(0, Number(startRaw || 0) || 0);

  const allowedOrigins = parseAllowedOriginsParam(sp?.get('allowedOrigins'));

  return {
    controls,
    loop,
    allowFullscreen,
    ui,
    start,
    allowedOrigins,
    langSwitch,
  };
}
