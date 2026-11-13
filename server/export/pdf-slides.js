import { STATIC_GRADIENT_CSS } from '../utils/static-gradient-css.js';
import { renderSlideHtml } from '../utils/render-slide.js';
import { filterForExport } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { resolveDeckLang } from '../../shared/i18n-utils.js';
import { embedImgSrcDataUrls } from '../utils/html-utils.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';
import { debugLog } from '../utils/debug-log.js';
import {
  buildPrismKatexTags,
  detectPrismKatexNeeds,
} from '../utils/prism-katex.js';
import {
  buildScriptChain,
  detectLayoutRuntimeNeeds,
} from '../utils/script-chain.js';
import { getAppBaseUrl } from '../config/utils.js';
import { staticVideoContext } from './static-video.js';
import {
  loadExportCssBundle,
  buildExportStyleContent,
  embedSlideImages,
} from './css-bundle.js';
import { exportImageEmbedTransform } from './image-compress.js';
import { buildDocumentHead } from '../utils/head-chain.js';
import {
  measureImageDisplayPx,
  displayAwareEmbedTransform,
} from './image-measure.js';
import { rasterizeGradientBackgrounds } from './gradient-raster.js';

/**
 * Document CSS that never varies with the deck: the native-size page/stage
 * boxes and the print rules.
 *
 * Hoisted out of the document template so the gradient raster can probe the
 * *real* cascade before the document exists. A pseudo-element layer only paints
 * if `.pdf-stage`/`.pdf-stage .slide` have given it a box, so a probe built from
 * the theme CSS alone would measure a layer that is not laid out yet.
 */
const PDF_DOC_CSS = `
      /* Make browsers preserve colors as much as possible in print/PDF */
      html, body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      body {
        margin: 0;
        padding: 0;
        background: #1b1f1e;
      }

      .pdf-toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        padding: 12px 16px;
        background: rgba(0,0,0,0.72);
        color: #fff;
        display: flex;
        gap: 12px;
        align-items: center;
      }
      .pdf-toolbar .btn { border-radius: 6px; }

      /*
       * One slide per page, at the slide's native 1600x900 (16:9) size.
       * Why native instead of scaling into A4: a CSS transform: scale() on the
       * 1600x900 canvas is rasterized inconsistently by Chromium's print/PDF
       * pipeline (headless on Linux clips the bottom of absolutely-positioned
       * elements; "Open in Preview" rotates; Safari drops backgrounds), while
       * the very same engine renders the slide perfectly at native size (cf.
       * the PNG export). So we drop the transform entirely and make the page
       * the size of the slide. 1600px = 16.667in, 900px = 9.375in (96dpi).
       * Printing this on A4 just "fits to page" — one slide per sheet, never
       * split — so paper printing still works.
       */
      .pdf-page {
        position: relative;
        width: 1600px;
        height: 900px;
        margin: 14mm auto;
        background: #fff;
        overflow: hidden;
        box-shadow: 0 14px 40px rgba(0,0,0,0.35);
      }

      .pdf-stage {
        position: absolute;
        top: 0;
        left: 0;
        width: 1600px;
        height: 900px;
      }
      .pdf-stage .slide {
        width: 1600px;
        height: 900px;
        max-width: none;
        max-height: none;
      }

      @media print {
        body { background: #fff; }
        .pdf-toolbar { display: none !important; }
        .pdf-page {
          margin: 0;
          box-shadow: none;
        }
        @page {
          /* Native slide size; no scaling transform involved. */
          size: 1600px 900px;
          margin: 0;
        }
      }
`;

/**
 * The document's full `<style>` content, minus the gradient-raster overrides.
 *
 * Built twice per export on purpose: once to probe the real cascade before any
 * bitmap exists, and once for the finished document — by then `css.themeVarsCss`
 * may have had its rasterized gradient declarations reduced to a plain colour.
 * The overrides are appended after this block, so they win any specificity tie.
 *
 * Exported so a test can assemble the same cascade and flip the gate below,
 * which is the only way to assert that a layer is rasterized *because* it paints
 * rather than that this export happens to keep them all switched off.
 *
 * @param {Object} bundle - CSS bundle from `loadExportCssBundle`.
 * @returns {string}
 */
export function buildStyleContent(bundle) {
  return buildExportStyleContent(bundle, [STATIC_GRADIENT_CSS, PDF_DOC_CSS]);
}

export async function buildSlidesPdfHtml(
  repoRoot,
  pres,
  { theme = null, watermark = null, slideTypes = null } = {},
) {
  pres = filterForExport(pres, { slideTypes });
  const docLang = resolveDocLangFromPresentation(pres);
  // Public base URL for the video-slide "watch online" deep-link (empty when no
  // APP_URL/DOMAIN is configured; the resolver then falls back to provider URLs).
  const baseUrl = getAppBaseUrl();

  const rawTitle = pres.title || 'Presentation';
  const title = escapeHtml(rawTitle);

  // Downsample + recompress images as they are inlined so a full-res photo
  // doesn't drag its original pixels into the PDF (null = compression disabled).
  // This flat-cap transform stays on the field-value pass below (top-level images
  // are near full-bleed, so the flat cap already fits) and on video posters; the
  // <img src> pass gets a display-aware transform once the layout is measured.
  const imageTransform = exportImageEmbedTransform();

  // One embed cache for the whole export run: an image referenced both as a
  // field value (pass 1 below) and in the rendered <img src> (pass 2) is
  // fetched + recompressed only once. Also dedupes in-flight fetches.
  const embedCache = new Map();
  const embedStartedAt = Date.now();

  // Loaded here rather than at the top of the function so the theme's own
  // assets ride the same transform and cache as every other image: a theme
  // background is full-bleed and is otherwise the single largest thing on the
  // slide, and it would have been the one image embedded at full resolution.
  const css = await loadExportCssBundle(repoRoot, theme, watermark, {
    slides: pres.slides || [],
    slideTypes,
    transform: imageTransform,
    cache: embedCache,
  });

  // Embed uploads referenced as field values. embedRemote inlines remote
  // http(s) images through the SSRF guard (or strips them) so no user-supplied
  // URL reaches headless Chrome at setContent time. See
  // docs/reference/security-posture.md § SSRF guard on server-side image fetches.
  const slides = await embedSlideImages(repoRoot, pres.slides, {
    transform: imageTransform,
    embedRemote: true,
    cache: embedCache,
  });

  // A video cannot play in a PDF: the video slide renders its poster in the
  // embed's box with a caption pointing at where it can be watched.
  const slidesHtml = await Promise.all(
    slides.map(async (s, i) =>
      renderSlideHtml(s, {
        theme,
        slideTypes,
        stripEditorAttrs: true,
        lang: resolveDeckLang(pres),
        staticVideo: await staticVideoContext(s, {
          transform: imageTransform,
          cache: embedCache,
          watch: { pres, baseUrl, slideIndex: i },
        }),
      }),
    ),
  );

  // A themed slide background built from alpha gradients leaves Chrome as a
  // per-pixel PostScript shading, which costs seconds per page in a PDF reader.
  // Render it once to a bitmap instead; see server/export/gradient-raster.js for
  // the measurements and for why precomposing to opaque stops is not an option.
  // `styleContent` is the pre-raster cascade: the pass loads it in Chrome to ask
  // which pseudo-element layers actually paint, which no amount of CSS-text
  // reading can answer (a fork changes the answer by changing the gate).
  const gradients = await rasterizeGradientBackgrounds({
    themeVarsCss: css.themeVarsCss,
    slidesHtml,
    styleContent: buildStyleContent(css),
  });
  css.themeVarsCss = gradients.themeVarsCss;

  // Measure how big each <img src> is actually drawn, so it can be capped at a
  // retina margin over its display size instead of a flat pixel ceiling — the
  // grid/gallery thumbnails that hold most of the image bytes are drawn tiny but
  // otherwise embed at the same 2600px cap as a full-bleed photo. Only the local
  // <img src> images the pass below inlines are measured; skipped entirely when
  // compression is off or there is nothing local to embed. See image-measure.js.
  const displayPx = imageTransform
    ? await measureImageDisplayPx({
        slidesHtml,
        styleContent: buildStyleContent(css),
      })
    : new Map();
  const imgSrcTransform =
    displayAwareEmbedTransform(displayPx) ?? imageTransform;

  let pagesHtml = slidesHtml
    .map((slideHtml, i) => {
      const stageClass = gradients.stageClasses[i]
        ? ` ${gradients.stageClasses[i]}`
        : '';
      return `<div class="pdf-page"><div class="pdf-stage ps-theme${stageClass}">${css.wmHtml}${slideHtml}</div></div>`;
    })
    .join('\n');
  pagesHtml = await embedImgSrcDataUrls(repoRoot, pagesHtml, {
    transform: imgSrcTransform,
    embedRemote: true,
    cache: embedCache,
  });
  debugLog(
    `[pdf-export] embedded ${embedCache.size} unique image(s) in ${Date.now() - embedStartedAt}ms`,
  );

  // The document is handed to Chrome through setContent(), which has no origin
  // to resolve /client/vendor/ against: the vendored copies go in inline.
  const highlightNeeds = detectPrismKatexNeeds(pagesHtml);

  // A4 landscape in CSS pixels varies by browser DPI; we use JS to scale the 1600x900 slide canvas per page.
  return `${buildDocumentHead({
    lang: docLang,
    title: rawTitle,
    head: [buildPrismKatexTags(highlightNeeds)],
    styles: [`${buildStyleContent(css)}\n\n${gradients.extraCss}`],
  })}
  <body>
    <div class="pdf-toolbar">
      <div style="flex:1">${title}</div>
      <button class="btn btn-primary" onclick="window.print()">Save as PDF</button>
      <div style="opacity:0.85; font-size:12px;">Tip: if colors look muted, enable “Background graphics” in the print dialog.</div>
    </div>
    ${pagesHtml}
    ${buildScriptChain({
      needs: highlightNeeds,
      // A static sheet: the layout runtimes only, never the countdown.
      slideNeeds: detectLayoutRuntimeNeeds(pagesHtml),
    })}
  </body>
</html>`;
}
