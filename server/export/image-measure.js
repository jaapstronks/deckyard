/* global document */ // The page.evaluate() callback below runs in the browser context.
/**
 * Display-aware image caps for the PDF export.
 *
 * ## Why
 *
 * `image-compress.js` promises in its docstring to shrink each raster "to a
 * retina margin over its **display size**", but the size it actually enforces is
 * a flat `DEFAULT_MAX_PX` on the longest edge — the source resolution, not the
 * on-page one. On a 1200pt export page that lands twice wrong:
 *
 * - a full-bleed photo covers the whole 1600px canvas and gets 2600px — ~1.6×
 *   more pixels than the slide can show;
 * - a portrait in a 24-up grid is ~150px wide on the page yet still gets capped
 *   at 2600px — roughly 1000 ppi for a 2.5-inch box, ~100× too many pixels.
 *
 * The second category is the bulk of the bytes (measured on the CIIIC Midterm
 * deck: 50.7% of image bytes sat above 400 ppi). A flat cap misses it by
 * construction, because it never looks at how big the image is drawn.
 *
 * ## What this does
 *
 * The export already loads the assembled document in headless Chrome for the
 * gradient-raster probe. This module runs one more measurement pass over the
 * same document — before any bytes are embedded — and reads the largest
 * `getBoundingClientRect()` each `<img src>` is drawn at. Slide images are
 * CSS-sized (`width:100%;height:100%;object-fit:cover/contain` inside a
 * fixed-size box), so the box is determined by the cascade, not by the image
 * having loaded: the measurement is correct even though the probe is offline and
 * the `/uploads` src never resolves.
 *
 * The per-URL display size then becomes a per-URL cap: `ceil(displayPx * scale)`,
 * clamped down by the existing `maxPx` ceiling and up by a small floor so a
 * thumbnail that someone zooms into does not turn to mush. An image whose URL we
 * could not measure (a `data:` src already embedded, an intrinsic-sized image
 * that did not load) falls back to the flat cap — identical to today, never
 * worse.
 *
 * `scale` defaults to 2 (retina): a full-bleed image ends up at ~2× the canvas
 * width, i.e. ≥290 ppi at print size, and stays visually lossless; the win is
 * entirely in the thumbnails, which drop from 2600px to a few hundred.
 *
 * Best-effort throughout: no Chrome, a probe that throws, a src we cannot read —
 * any of those leaves the flat cap in place. Correct-but-large beats broken.
 */

import { getPuppeteerBrowser } from '../utils/puppeteer-browser.js';
import { debugLog } from '../utils/debug-log.js';
import { envInt } from '../config/utils.js';
import { pdfImageCompressionConfig, compressImageForEmbed } from './image-compress.js';

/** Retina margin over the measured display size. A full-bleed image at 2× the
 *  1600px canvas is ≥290 ppi at print size — no visible loss, all the savings in
 *  the small stuff. */
export const DEFAULT_RETINA_SCALE = 2;

/** Longest-edge floor, so an image drawn tiny still survives a zoom into the
 *  PDF. Only binds below ~128px of display; the 150px grid portraits the bug is
 *  about clear it comfortably. */
export const MIN_DISPLAY_CAP = 256;

/**
 * Operator override for the retina margin, mostly to make a before/after
 * measurement reproducible without patching the source (mirrors
 * `PDF_GRADIENT_RASTER_WIDTH`). Valid range [1, 4]; anything outside falls
 * back to the default per the envInt contract.
 *
 * @returns {number}
 */
export function retinaScale() {
  return envInt('PDF_EXPORT_IMAGE_RETINA_SCALE', DEFAULT_RETINA_SCALE, {
    min: 1,
    max: 4,
  });
}

/**
 * The longest-edge cap for an image drawn `displayPx` across, given the flat
 * config and the retina scale.
 *
 * Returns the flat `maxPx` unchanged when the display size is unknown or
 * non-positive, so an unmeasured image behaves exactly as it does today.
 *
 * @param {number|undefined} displayPx - Largest rendered longest-edge, CSS px.
 * @param {{ maxPx: number, quality: number }} config
 * @param {number} scale - Retina margin.
 * @returns {number} Longest-edge cap in pixels.
 */
export function displayCap(displayPx, config, scale) {
  const maxPx = config.maxPx;
  if (!(displayPx > 0)) return maxPx;
  const target = Math.ceil(displayPx * scale);
  return Math.min(maxPx, Math.max(MIN_DISPLAY_CAP, target));
}

/** Local asset roots whose images the export inlines and can recompress. Remote
 *  and `data:` srcs are skipped: nothing to measure-then-shrink at this point.
 *  Non-global on purpose — `.test()` on a `/g` regex carries `lastIndex`. */
const LOCAL_IMG_SRC_RE =
  /<img\b[^>]*\bsrc="\/(?:uploads|assets|client|custom\/assets|custom\/themes)\//i;

/**
 * Whether a document has any locally-embedded `<img>` worth measuring. Launching
 * Chrome is only justified when the answer is yes.
 *
 * @param {string[]} slidesHtml
 * @returns {boolean}
 */
export function hasMeasurableImages(slidesHtml) {
  return (Array.isArray(slidesHtml) ? slidesHtml : []).some((html) =>
    LOCAL_IMG_SRC_RE.test(String(html || '')),
  );
}

/**
 * Open an offline page on the shared browser, or `null` when none is available.
 *
 * Offline for the same reason `gradient-raster.js` is: this pass runs *before*
 * `embedImgSrcDataUrls`, so the slide HTML can still carry a raw remote
 * `<img src>` (a theme logo, custom HTML). Nothing measured here depends on a
 * subresource loading, so the safe answer is to fetch none and never let Chrome
 * reach the network on user-supplied markup.
 *
 * @returns {Promise<import('puppeteer-core').Page|null>}
 */
async function openMeasurePage() {
  try {
    const browser = await getPuppeteerBrowser({ featureName: 'PDF export' });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const allowed = url.startsWith('data:') || url === 'about:blank';
      Promise.resolve(allowed ? req.continue() : req.abort()).catch(() => {
        // The page can close mid-flight; a dangling request is not an error.
      });
    });
    return page;
  } catch (err) {
    debugLog(`[pdf-export] image measure skipped: ${err?.message || err}`);
    return null;
  }
}

/**
 * Measure the largest on-page size, in CSS pixels, of every locally-embedded
 * `<img src>` in the assembled export document.
 *
 * @param {Object} opts
 * @param {string[]} opts.slidesHtml - Rendered slide HTML, in page order.
 * @param {string} opts.styleContent - Everything that goes in the document's
 *   `<style>` — the same cascade the final export uses, so boxes measure identically.
 * @returns {Promise<Map<string, number>>} src → largest longest-edge, CSS px.
 *   Empty when there is nothing to measure or no browser.
 */
export async function measureImageDisplayPx({ slidesHtml, styleContent }) {
  const slides = Array.isArray(slidesHtml) ? slidesHtml : [];
  /** @type {Map<string, number>} */
  const out = new Map();
  if (!slides.length || !styleContent || !hasMeasurableImages(slides)) return out;

  const page = await openMeasurePage();
  if (!page) return out;

  try {
    // The same wrappers the real document uses, so the 1600x900 stage box and
    // every `.pdf-stage`/`.ps-theme` selector resolve identically — the img box
    // is then the box it has in the export. No CDN <script>/<link> tags: this
    // pass must not reach the network, and no measurement depends on them.
    const body = slides
      .map((s) => `<div class="pdf-page"><div class="pdf-stage ps-theme">${s}</div></div>`)
      .join('\n');
    await page.setViewport({ width: 1600, height: 900 });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>${styleContent}</style>${body}`,
      // Local <img src> cannot resolve under setContent (no base URL), so waiting
      // for `load` would only wait for them to fail. The box is CSS-driven and
      // available at `domcontentloaded`.
      { waitUntil: 'domcontentloaded' },
    );

    const measured = await page.evaluate(() => {
      const rows = [];
      for (const img of Array.from(document.querySelectorAll('img[src]'))) {
        const src = img.getAttribute('src') || '';
        if (!src.startsWith('/')) continue; // only local, embeddable assets
        const rect = img.getBoundingClientRect();
        const longest = Math.max(rect.width, rect.height);
        if (longest > 0) rows.push([src, longest]);
      }
      return rows;
    });

    for (const [src, longest] of measured) {
      const prev = out.get(src) || 0;
      if (longest > prev) out.set(src, longest);
    }
    debugLog(`[pdf-export] measured display size of ${out.size} image(s)`);
    return out;
  } catch (err) {
    debugLog(`[pdf-export] image measure failed: ${err?.message || err}`);
    return out;
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Build a display-aware embed transform, or `null` when compression is disabled.
 *
 * Matches the `transform(buf, ext, mime, url)` hook consumed by
 * `toDataUrlIfLocal`: the `url` selects the per-image cap from `displayPx`. A URL
 * absent from the map (unmeasured, `data:`, remote) uses the flat cap, so this is
 * a strict tightening — never looser than the plain transform.
 *
 * @param {Map<string, number>} displayPx - src → largest display longest-edge.
 * @returns {((buf: Buffer, ext: string, mime: string, url?: string) => Promise<{buf: Buffer, mime: string}>) | null}
 */
export function displayAwareEmbedTransform(displayPx) {
  const config = pdfImageCompressionConfig();
  if (!config) return null;
  const scale = retinaScale();
  const map = displayPx instanceof Map ? displayPx : new Map();
  return (buf, ext, mime, url) => {
    const cap = displayCap(map.get(url), config, scale);
    const perImage = cap === config.maxPx ? config : { maxPx: cap, quality: config.quality };
    return compressImageForEmbed(buf, ext, mime, perImage);
  };
}
