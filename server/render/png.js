import { renderSlideHtml } from '../utils/render-slide.js';
import { getPuppeteerBrowser } from '../utils/puppeteer-browser.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import {
  escapeHtml,
  toDataUrlIfLocal,
  embedImgSrcDataUrls,
  imageFieldKeysForType,
} from '../utils/html-utils.js';
import { buildPrismKatexCdnTags, buildPrismKatexInitScriptTag } from '../utils/prism-katex.js';
import { renderVideoSlidePngHtml } from '../utils/video-slide-html.js';
import { loadExportCssBundle, buildExportStyleContent } from '../export/css-bundle.js';

async function buildSlidePngHtml(repoRoot, slide, { theme = null, slideTypes = null } = {}) {
  const css = await loadExportCssBundle(repoRoot, theme, null);

  const cloned = structuredClone(slide);
  const imgKeys = imageFieldKeysForType(cloned?.type);
  for (const k of imgKeys) {
    if (cloned?.content?.[k]) {
      // embedRemote: inline remote http(s) images through the SSRF guard (or
      // strip) so no user-supplied URL reaches headless Chrome. Security 2.
      cloned.content[k] = await toDataUrlIfLocal(
        repoRoot,
        cloned.content[k],
        { includeClient: true, embedRemote: true }
      );
    }
  }

  let slideHtml =
    cloned?.type === 'video-slide'
      ? renderVideoSlidePngHtml(cloned)
      : renderSlideHtml(cloned, { theme, slideTypes, stripEditorAttrs: true });
  slideHtml = await embedImgSrcDataUrls(repoRoot, slideHtml, {
    includeClient: true,
    embedRemote: true,
  });
  const docLang = resolveDocLangFromPresentation({ slides: [cloned] });

  return `<!doctype html>
<html lang="${escapeHtml(docLang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${buildPrismKatexCdnTags()}
    <style>
${buildExportStyleContent(css)}
      /* Rendered PNGs are static; keep gradients deterministic and avoid animation timing. */
      .ps-theme { --t-gradient-enabled: 0; }
      html, body { margin: 0; padding: 0; }
      body { width: 1600px; height: 900px; overflow: hidden; }
      .slide { width: 1600px !important; height: 900px !important; }
      .ps-theme { position: relative; width: 1600px; height: 900px; }
    </style>
  </head>
  <body>
    <div class="ps-theme">${css.wmHtml}${slideHtml}</div>
    ${buildPrismKatexInitScriptTag()}
  </body>
</html>`;
}

export async function renderSlideToPngBuffer(
  repoRoot,
  slide,
  { scale = 2, theme = null, slideTypes = null } = {}
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
    const html = await buildSlidePngHtml(repoRoot, slide, { theme, slideTypes });
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
          })
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
    return buf;
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}
