import { renderSlideHtml } from '../utils/render-slide.js';
import { stripFontFacesFromCss } from '../utils/embed-fonts.js';
import { filterForExport } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import {
  escapeHtml,
  embedImgSrcDataUrls,
  isProbablyUrl,
} from '../utils/html-utils.js';
import { buildPrismKatexCdnTags, buildPrismKatexInitScript } from '../utils/prism-katex.js';
import { loadExportCssBundle, embedSlideImages } from './css-bundle.js';
import { pdfImageEmbedTransform } from './image-compress.js';

function renderVideoSlidePdfHtml(slide) {
  const content =
    slide && typeof slide === 'object' ? slide.content : {};
  const title = String(content?.title || '').trim();
  const bg =
    content?.background === 'lime'
      ? 'slide-bg-lime'
      : 'slide-bg-mist';
  const source = String(content?.source || '').trim();

  const titleHtml = title
    ? `<div class="heading">${escapeHtml(title)}</div>`
    : '';

  const linkHtml = source
    ? `<div class="video-empty">
        <div style="font-weight:600; margin-bottom:6px;">Video</div>
        ${
          isProbablyUrl(source)
            ? `<div style="word-break:break-all;">
                <a href="${escapeHtml(
                  source
                )}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                source
              )}</a>
              </div>`
            : `<div style="word-break:break-all;">${escapeHtml(
                source
              )}</div>`
        }
        <div style="margin-top:8px; opacity:0.75;">
          (Video’s can’t worden ingesloten in een PDF. Gebruik de link hierboven.)
        </div>
      </div>`
    : `<div class="video-empty">Video bron ontbreekt</div>`;

  return `
    <div class="slide slide-video ${bg}">
      <div class="slide-inner">
        ${titleHtml}
        <div class="video-frame">
          ${linkHtml}
        </div>
      </div>
    </div>
  `;
}

export async function buildSlidesPdfHtml(
  repoRoot,
  pres,
  { theme = null, watermark = null, slideTypes = null } = {}
) {
  pres = filterForExport(pres);
  const docLang = resolveDocLangFromPresentation(pres);
  const css = await loadExportCssBundle(repoRoot, theme, watermark);

  const title = escapeHtml(pres.title || 'Presentation');

  // Downsample + recompress images as they are inlined so a full-res photo
  // doesn't drag its original pixels into the PDF (null = compression disabled).
  const imageTransform = pdfImageEmbedTransform();

  // Embed uploads referenced as field values
  const slides = await embedSlideImages(repoRoot, pres.slides, {
    transform: imageTransform,
  });

  let pagesHtml = slides
    .map((s) => {
      const slideHtml =
        s?.type === 'video-slide'
          ? renderVideoSlidePdfHtml(s)
          : renderSlideHtml(s, { theme, slideTypes });
      return `<div class="pdf-page"><div class="pdf-stage ps-theme">${css.wmHtml}${slideHtml}</div></div>`;
    })
    .join('\n');
  pagesHtml = await embedImgSrcDataUrls(repoRoot, pagesHtml, {
    includeClient: true,
    transform: imageTransform,
  });

  // A4 landscape in CSS pixels varies by browser DPI; we use JS to scale the 1600x900 slide canvas per page.
  return `<!doctype html>
<html lang="${escapeHtml(docLang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} (PDF Slides)</title>
    ${buildPrismKatexCdnTags()}
    <style>
${css.fontCss}
${stripFontFacesFromCss(css.appCss)}
${css.themeVarsCss}
${css.themeCss}
${stripFontFacesFromCss(css.slidesCss)}
${css.wmCss}

      /* Export/print is a static medium; disable animated gradients to avoid flaky print engines. */
      .ps-theme { --t-gradient-enabled: 0; }

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
