import { renderSlideHtml } from '../utils/render-slide.js';
import { filterForExport } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { resolveDeckLang } from '../../shared/i18n-utils.js';
import { escapeHtml, embedImgSrcDataUrls } from '../utils/html-utils.js';
import { debugLog } from '../utils/debug-log.js';
import { buildPrismKatexCdnTags, buildPrismKatexInitScript } from '../utils/prism-katex.js';
import { getAppBaseUrl } from '../config/utils.js';
import { resolveVideoThumbnailDataUrl } from './video-thumbnail.js';
import { resolveVideoWatchUrl, videoPdfCopy } from './video-watch-url.js';
import { loadExportCssBundle, buildExportStyleContent, embedSlideImages } from './css-bundle.js';
import { pdfImageEmbedTransform } from './image-compress.js';
import { rasterizeGradientBackgrounds } from './gradient-raster.js';

/**
 * Render a video slide as a static "watch online" placeholder for PDF export.
 *
 * A video can't play in a PDF, so instead of the live embed we render a
 * laptop-framed still (with a play badge) on the left and, on the right, copy
 * in the deck language pointing the reader at a live URL. The URL is resolved
 * server-side by {@link resolveVideoWatchUrl} (published deck deep-link →
 * provider URL → none). See docs/plans/video-slide-pdf-export.md.
 *
 * @param {object} slide - The video slide.
 * @param {object} opts
 * @param {object} opts.pres - The presentation (for its published state).
 * @param {number} opts.slideIndex - 0-based export index (for the deck deep-link).
 * @param {string} opts.baseUrl - Public base URL (from getAppBaseUrl()).
 * @param {string} opts.docLang - Normalised document language.
 * @param {Function} [opts.transform] - Image-bytes transform for the still.
 * @param {Map<string, Promise<string>>} [opts.cache] - Per-run embed cache.
 * @returns {Promise<string>} HTML for one PDF page.
 */
async function renderVideoSlidePdfHtml(
  slide,
  { pres, slideIndex, baseUrl, docLang, transform = null, cache = null }
) {
  const content = slide && typeof slide === 'object' ? slide.content : {};
  const title = String(content?.title || '').trim();
  const bg = content?.background === 'lime' ? 'slide-bg-lime' : 'slide-bg-mist';
  const copy = videoPdfCopy(docLang);

  const titleHtml = title
    ? `<div class="heading vpdf-title">${escapeHtml(title)}</div>`
    : `<div class="heading vpdf-title vpdf-kicker">${escapeHtml(copy.kicker)}</div>`;

  // The still: the video's own poster, fetched and inlined here rather than left
  // as a remote <img src> for the generic embed pass. Bunny's CDN 403s a request
  // without a referer, so that pass would silently drop it. See video-thumbnail.js.
  const thumbnailDataUrl = await resolveVideoThumbnailDataUrl(content, { transform, cache });
  const stillHtml = thumbnailDataUrl
    ? `<img class="vpdf-still" src="${escapeHtml(thumbnailDataUrl)}" alt="${escapeHtml(
        title || copy.kicker
      )}" />`
    : `<div class="vpdf-still vpdf-still--empty"></div>`;

  // Left: a laptop outline (CSS chrome, not path data) framing the still, with
  // a play badge overlaid to read as "this is a video".
  const deviceHtml = `
    <div class="vpdf-laptop">
      <div class="vpdf-screen">
        ${stillHtml}
        <div class="vpdf-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="vpdf-base"></div>
    </div>
  `;

  // Right: deck-language copy + the resolved watch URL (or a "not online" line).
  // Printed link text drops the scheme (and a trailing slash): the reader has to
  // read or retype it, and `https://` is noise in both cases. The href keeps it.
  const { url } = resolveVideoWatchUrl(slide, pres, { baseUrl, slideIndex });
  const linkText = String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const linkHtml = url
    ? `<p class="vpdf-lead">${escapeHtml(copy.lead)}</p>
       <a class="vpdf-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
         linkText
       )}</a>`
    : `<p class="vpdf-lead">${escapeHtml(copy.noUrl)}</p>`;

  return `
    <div class="slide slide-video vpdf ${bg}">
      <div class="slide-inner vpdf-grid">
        <div class="vpdf-left">
          ${deviceHtml}
        </div>
        <div class="vpdf-right">
          ${titleHtml}
          <div class="vpdf-copy">
            ${linkHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Document CSS that never varies with the deck: the video-slide placeholder,
 * the native-size page/stage boxes and the print rules.
 *
 * Hoisted out of the document template so the gradient raster can probe the
 * *real* cascade before the document exists. A pseudo-element layer only paints
 * if `.pdf-stage`/`.pdf-stage .slide` have given it a box, so a probe built from
 * the theme CSS alone would measure a layer that is not laid out yet.
 */
const PDF_DOC_CSS = `
      /*
       * Video-slide "watch online" placeholder. A video can't play in a PDF, so
       * we render a laptop-framed still on the left and deck-language copy + a
       * live watch URL on the right. Laid out for the native 1600x900 canvas.
       */
      .slide-video.vpdf .vpdf-grid {
        display: grid;
        grid-template-columns: 1.05fr 0.95fr;
        gap: 90px;
        align-items: center;
        height: 100%;
        box-sizing: border-box;
        padding: 110px 130px;
      }
      .vpdf-left { display: flex; align-items: center; justify-content: center; }
      /* Laptop: a screen bezel over a tapered base bar. Simple boxes, no path data. */
      .vpdf-laptop { width: 100%; max-width: 620px; }
      .vpdf-screen {
        position: relative;
        aspect-ratio: 16 / 9;
        border: 14px solid #1b1f1e;
        border-radius: 18px;
        background: #0b0f0e;
        overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.28);
      }
      .vpdf-still {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .vpdf-still--empty {
        background: linear-gradient(135deg, #2a312f 0%, #11201a 100%);
      }
      .vpdf-play {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 128px;
        height: 128px;
        border-radius: 50%;
        background: rgba(0,0,0,0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
      }
      .vpdf-play svg { width: 56px; height: 56px; margin-left: 8px; }
      .vpdf-base {
        width: 118%;
        height: 26px;
        margin: 0 auto;
        margin-left: -9%;
        background: #1b1f1e;
        border-radius: 0 0 16px 16px;
        box-shadow: 0 10px 22px rgba(0,0,0,0.22);
      }
      .vpdf-right { min-width: 0; }
      .slide-video.vpdf .vpdf-title { margin: 0 0 26px; }
      .vpdf-title.vpdf-kicker { opacity: 0.72; }
      .vpdf-lead {
        font-size: 34px;
        line-height: 1.4;
        margin: 0 0 24px;
      }
      .vpdf-url {
        display: inline-block;
        font-size: 30px;
        font-weight: 600;
        word-break: break-all;
        text-decoration: underline;
      }

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
 * @param {Object} bundle - CSS bundle from `loadExportCssBundle`.
 * @returns {string}
 */
function buildStyleContent(bundle) {
  return `${buildExportStyleContent(bundle)}

      /* Export/print is a static medium; disable animated gradients to avoid flaky print engines. */
      .ps-theme { --t-gradient-enabled: 0; }
${PDF_DOC_CSS}`;
}

export async function buildSlidesPdfHtml(
  repoRoot,
  pres,
  { theme = null, watermark = null, slideTypes = null } = {}
) {
  pres = filterForExport(pres);
  const docLang = resolveDocLangFromPresentation(pres);
  // Public base URL for the video-slide "watch online" deep-link (empty when no
  // APP_URL/DOMAIN is configured; the resolver then falls back to provider URLs).
  const baseUrl = getAppBaseUrl();
  const css = await loadExportCssBundle(repoRoot, theme, watermark);

  const title = escapeHtml(pres.title || 'Presentation');

  // Downsample + recompress images as they are inlined so a full-res photo
  // doesn't drag its original pixels into the PDF (null = compression disabled).
  const imageTransform = pdfImageEmbedTransform();

  // One embed cache for the whole export run: an image referenced both as a
  // field value (pass 1 below) and in the rendered <img src> (pass 2) is
  // fetched + recompressed only once. Also dedupes in-flight fetches.
  const embedCache = new Map();
  const embedStartedAt = Date.now();

  // Embed uploads referenced as field values. embedRemote inlines remote
  // http(s) images through the SSRF guard (or strips them) so no user-supplied
  // URL reaches headless Chrome at setContent time. See security-hardening 2.
  const slides = await embedSlideImages(repoRoot, pres.slides, {
    transform: imageTransform,
    embedRemote: true,
    cache: embedCache,
  });

  const slidesHtml = await Promise.all(
    slides.map(async (s, i) =>
      s?.type === 'video-slide'
        ? renderVideoSlidePdfHtml(s, {
            pres,
            slideIndex: i,
            baseUrl,
            docLang,
            transform: imageTransform,
            cache: embedCache,
          })
        : renderSlideHtml(s, {
            theme,
            slideTypes,
            stripEditorAttrs: true,
            lang: resolveDeckLang(pres),
          })
    )
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

  let pagesHtml = slidesHtml
    .map((slideHtml, i) => {
      const stageClass = gradients.stageClasses[i]
        ? ` ${gradients.stageClasses[i]}`
        : '';
      return `<div class="pdf-page"><div class="pdf-stage ps-theme${stageClass}">${css.wmHtml}${slideHtml}</div></div>`;
    })
    .join('\n');
  pagesHtml = await embedImgSrcDataUrls(repoRoot, pagesHtml, {
    includeClient: true,
    transform: imageTransform,
    embedRemote: true,
    cache: embedCache,
  });
  debugLog(
    `[pdf-export] embedded ${embedCache.size} unique image(s) in ${Date.now() - embedStartedAt}ms`,
  );

  // A4 landscape in CSS pixels varies by browser DPI; we use JS to scale the 1600x900 slide canvas per page.
  return `<!doctype html>
<html lang="${escapeHtml(docLang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} (PDF Slides)</title>
    ${buildPrismKatexCdnTags()}
    <style>
${buildStyleContent(css)}

${gradients.extraCss}
    </style>
  </head>
  <body>
    <div class="pdf-toolbar">
      <div style="flex:1">${title}</div>
      <button class="btn btn-primary" onclick="window.print()">Save as PDF</button>
      <div style="opacity:0.85; font-size:12px;">Tip: if colors look muted, enable “Background graphics” in the print dialog.</div>
    </div>
    ${pagesHtml}
    <script>
      (function() {
        ${buildPrismKatexInitScript()}
      })();
    </script>
  </body>
</html>`;
}
