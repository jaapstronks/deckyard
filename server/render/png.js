/* global document */ // page.evaluate() callbacks below run in the browser context.
import { renderSlideHtml } from '../utils/render-slide.js';
import {
  getPuppeteerBrowser,
  toNodeBuffer,
} from '../utils/puppeteer-browser.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import {
  toDataUrlIfLocal,
  embedImgSrcDataUrls,
  imageFieldKeysForType,
} from '../utils/html-utils.js';
import {
  buildPrismKatexTags,
  detectPrismKatexNeeds,
} from '../utils/prism-katex.js';
import { buildScriptChain } from '../utils/script-chain.js';
import { renderVideoSlidePngHtml } from '../utils/video-slide-html.js';
import { buildDocumentHead } from '../utils/head-chain.js';
import {
  loadExportCssBundle,
  buildExportStyleContent,
} from '../export/css-bundle.js';

/** The 1600x900 canvas this path renders into, plus the static-media gradient gate. */
const PNG_DOC_CSS = `
      /* Rendered PNGs are static; keep gradients deterministic and avoid animation timing. */
      .ps-theme { --t-gradient-enabled: 0; }
      html, body { margin: 0; padding: 0; }
      body { width: 1600px; height: 900px; overflow: hidden; }
      .slide { width: 1600px !important; height: 900px !important; }
      .ps-theme { position: relative; width: 1600px; height: 900px; }
`;

/**
 * Build the standalone HTML document a PNG export renders.
 *
 * Exported so `tests/export-structural-metrics.test.js` can measure the real
 * export document rather than a lookalike — a reconstruction would keep passing
 * through exactly the CSS-bundle and theme-var regressions the metrics exist to
 * catch.
 *
 * @param {string} repoRoot - Repository root path
 * @param {Object} slide - Slide to render
 * @param {Object} [options]
 * @param {Object} [options.theme] - Resolved theme
 * @param {Object} [options.slideTypes] - Slide type registry override
 * @param {string} [options.lang] - Render language
 * @returns {Promise<string>} - Complete HTML document
 */
export async function buildSlidePngHtml(
  repoRoot,
  slide,
  { theme = null, slideTypes = null, lang = null, docLang = '' } = {},
) {
  const css = await loadExportCssBundle(repoRoot, theme, null);

  const cloned = structuredClone(slide);
  const imgKeys = imageFieldKeysForType(cloned?.type);
  for (const k of imgKeys) {
    if (cloned?.content?.[k]) {
      // embedRemote: inline remote http(s) images through the SSRF guard (or
      // strip) so no user-supplied URL reaches headless Chrome. Security 2.
      cloned.content[k] = await toDataUrlIfLocal(repoRoot, cloned.content[k], {
        includeClient: true,
        embedRemote: true,
      });
    }
  }

  let slideHtml =
    cloned?.type === 'video-slide'
      ? await renderVideoSlidePngHtml(cloned)
      : renderSlideHtml(cloned, {
          theme,
          slideTypes,
          stripEditorAttrs: true,
          lang,
        });
  slideHtml = await embedImgSrcDataUrls(repoRoot, slideHtml, {
    includeClient: true,
    embedRemote: true,
  });
  // The deck's document language when the caller has one. A bare slide cannot
  // see a deck-level `pres.lang`, so an RTL deck would raster left-to-right —
  // the same gap the head chain closed for the document paths.
  const resolvedDocLang =
    docLang || resolveDocLangFromPresentation({ slides: [cloned] });

  // Rasterised through setContent(), which has no origin to resolve
  // /client/vendor/ against: the vendored copies go in inline.
  const highlightNeeds = detectPrismKatexNeeds(slideHtml);

  // No <title>: this document exists to be screenshotted at 1600x900 and is
  // never a tab, a bookmark or a share target.
  return `${buildDocumentHead({
    lang: resolvedDocLang,
    head: [buildPrismKatexTags({ ...highlightNeeds, mode: 'inlined' })],
    styles: [buildExportStyleContent(css, [PNG_DOC_CSS])],
  })}
  <body>
    <div class="ps-theme">${css.wmHtml}${slideHtml}</div>
    ${buildScriptChain({ needs: highlightNeeds })}
  </body>
</html>`;
}

export async function renderSlideToPngBuffer(
  repoRoot,
  slide,
  {
    scale = 2,
    theme = null,
    slideTypes = null,
    lang = null,
    docLang = '',
  } = {},
) {
  const s = Math.max(1, Math.min(3, Number(scale) || 2));
  const browser = await getPuppeteerBrowser({ featureName: 'PNG export' });
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: 1600,
      height: 900,
      deviceScaleFactor: s,
    });
    const html = await buildSlidePngHtml(repoRoot, slide, {
      theme,
      slideTypes,
      lang,
      docLang,
    });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    try {
      await page.evaluate(() => document.fonts?.ready);
    } catch {
      // ignore
    }
    // Wait for all images to load (or timeout)
    try {
      await page.evaluate(() => {
        return Promise.all(
          Array.from(document.querySelectorAll('img')).map((img) => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            return new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
              setTimeout(resolve, 5000); // 5s timeout per image
            });
          }),
        );
      });
    } catch {
      // ignore
    }
    // Wait for KaTeX to render (small delay to ensure scripts have executed)
    try {
      await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    } catch {
      // ignore
    }
    const buf = await page.screenshot({
      type: 'png',
      fullPage: false,
    });
    return toNodeBuffer(buf);
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}
