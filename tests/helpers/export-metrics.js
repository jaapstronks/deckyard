// The page.evaluate() callbacks below run inside headless Chrome, not in Node;
// `document` and `getComputedStyle` in them are the browser's, not this file's.

/**
 * Structural metric extraction for the export chain (B14 form 2).
 *
 * This is the measuring half of `tests/export-structural-metrics.test.js`; the
 * assertions and the tolerance live there, deliberately, so a baseline file
 * never encodes how strictly it is read.
 *
 * What it produces is a small JSON object per fixture: page count and page
 * size, the bounding boxes of title / subheading / body, the fonts the browser
 * loaded *and the family it actually painted with*, the dominant colour of the
 * frame, and anything sticking out of the 1600x900 slide. That set is chosen to
 * be reviewable in a diff and stable across rasterisers — see
 * `docs/plans/briefs/export-structural-metrics.md` for why full pixel
 * comparison was rejected.
 */

import sharp from 'sharp';

import { getPuppeteerBrowser, toNodeBuffer } from '../../server/utils/puppeteer-browser.js';
import { buildSlidePngHtml } from '../../server/render/png.js';
import { renderSlidesToPdfBuffer } from '../../server/render/pdf.js';
import { parsePdf } from '../../server/utils/convert-file/pdf-parser.js';

/** The slide frame every export renders into. */
export const FRAME = { width: 1600, height: 900 };

/**
 * Elements measured on the calibration slide, in the brief's own terms.
 * `content-slide` is used because it exposes the three roles as plain
 * `.heading` / `.subheading` / `.body` elements.
 */
export const MEASURED_SELECTORS = ['.slide .heading', '.slide .subheading', '.slide .body'];

/** Round to one decimal: enough to see a real layout shift, not sub-pixel noise. */
function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

/** `rgb(r, g, b)` / `rgba(...)` or `#rrggbb` → `[r, g, b]`, else null. */
export function parseCssColor(value) {
  const text = String(value || '').trim();
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const fn = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (fn) return [Math.round(+fn[1]), Math.round(+fn[2]), Math.round(+fn[3])];
  return null;
}

/**
 * The most common RGB triple in a PNG, and the share of the frame it covers.
 *
 * The theme's background token should win this by a wide margin on a
 * calibration slide, which is what makes it a usable check that the theme
 * variables actually reached the rendered document.
 *
 * @param {Buffer} pngBuffer
 * @returns {Promise<{rgb: number[], share: number}>}
 */
export async function dominantColor(pngBuffer) {
  const { data, info } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [key, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      best = key;
    }
  }
  return {
    rgb: [(best >> 16) & 0xff, (best >> 8) & 0xff, best & 0xff],
    share: bestCount / (info.width * info.height),
  };
}

/**
 * Ask Chrome which font it *actually painted* a node with.
 *
 * `getComputedStyle().fontFamily` only reports the stack that was requested, so
 * it stays cheerfully identical when a webfont fails to load and the browser
 * silently falls through to a system face. `CSS.getPlatformFontsForNode` reports
 * the resolved face and its glyph count, which is the one signal that catches
 * that class of "the export works but looks wrong" regression.
 *
 * @param {import('puppeteer-core').CDPSession} client
 * @param {number} rootNodeId
 * @param {string} selector
 * @returns {Promise<Array<{family: string, glyphs: number}>>}
 */
async function platformFonts(client, rootNodeId, selector) {
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: rootNodeId, selector });
  if (!nodeId) return [];
  const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts
    .map((f) => ({ family: String(f.familyName || ''), glyphs: Number(f.glyphCount || 0) }))
    .sort((a, b) => b.glyphs - a.glyphs);
}

/**
 * Measure one slide as the PNG export renders it.
 *
 * @param {string} repoRoot
 * @param {Object} slide
 * @param {Object} [options]
 * @param {Object} [options.theme]
 * @param {string[]} [options.selectors] - Elements to measure
 * @returns {Promise<Object>} - The metrics object for this fixture
 */
export async function measureSlide(repoRoot, slide, { theme = null, selectors = MEASURED_SELECTORS } = {}) {
  const browser = await getPuppeteerBrowser({ featureName: 'export metrics' });
  const page = await browser.newPage();
  try {
    // deviceScaleFactor 1: these are layout metrics in CSS pixels, and the
    // export's own scale option is already covered by the smoke test.
    await page.setViewport({ ...FRAME, deviceScaleFactor: 1 });
    const html = await buildSlidePngHtml(repoRoot, slide, { theme });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts?.ready);

    const inPage = await page.evaluate(
      ({ selectors: sels, frame }) => {
        const rectOf = (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };

        const elements = {};
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (!el) {
            elements[sel] = null;
            continue;
          }
          const cs = getComputedStyle(el);
          elements[sel] = {
            rect: rectOf(el),
            requestedFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          };
        }

        // Anything painted outside the frame is a layout escape, and invisible
        // to a "is the PNG blank" check because the crop hides it.
        const EPSILON = 0.5;
        const overflowing = [];
        for (const el of document.querySelectorAll('.slide, .slide *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          if (
            r.left < -EPSILON ||
            r.top < -EPSILON ||
            r.right > frame.width + EPSILON ||
            r.bottom > frame.height + EPSILON
          ) {
            overflowing.push({
              selector: `${el.tagName.toLowerCase()}.${String(el.className || '').split(/\s+/).filter(Boolean).join('.')}`,
              rect: rectOf(el),
            });
          }
        }

        // The colour the slide element actually resolved to. Which theme token
        // that is depends on the slide's `background` variant, so the test
        // compares it to the token the fixture declares rather than guessing.
        const slideEl = document.querySelector('.slide');
        const slideBackground = slideEl ? getComputedStyle(slideEl).backgroundColor : null;

        const loadedFonts = [...document.fonts]
          .filter((f) => f.status === 'loaded')
          .map((f) => `${f.family} ${f.weight}`)
          .sort();

        return {
          elements,
          overflowing,
          slideBackground,
          loadedFonts: [...new Set(loadedFonts)],
          documentFontsStatus: document.fonts.status,
        };
      },
      { selectors, frame: FRAME }
    );

    const client = await page.createCDPSession();
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument');

    const elements = {};
    for (const sel of selectors) {
      const measured = inPage.elements[sel];
      if (!measured) {
        elements[sel] = null;
        continue;
      }
      elements[sel] = {
        rect: {
          x: round1(measured.rect.x),
          y: round1(measured.rect.y),
          width: round1(measured.rect.width),
          height: round1(measured.rect.height),
        },
        fontSize: measured.fontSize,
        fontWeight: measured.fontWeight,
        requestedFamily: measured.requestedFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''),
        paintedFamilies: await platformFonts(client, root.nodeId, sel),
        text: measured.text,
      };
    }

    const png = toNodeBuffer(await page.screenshot({ type: 'png', fullPage: false }));
    const dominant = await dominantColor(png);

    return {
      frame: { ...FRAME },
      elements,
      overflowing: inPage.overflowing.map((o) => ({
        selector: o.selector,
        rect: {
          x: round1(o.rect.x),
          y: round1(o.rect.y),
          width: round1(o.rect.width),
          height: round1(o.rect.height),
        },
      })),
      slideBackground: inPage.slideBackground,
      loadedFonts: inPage.loadedFonts,
      documentFontsStatus: inPage.documentFontsStatus,
      dominantColor: { rgb: dominant.rgb, share: Math.round(dominant.share * 1000) / 1000 },
    };
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Measure the PDF a deck exports to: page count and page geometry.
 *
 * @param {string} repoRoot
 * @param {Object} deck
 * @param {Object} [options]
 * @param {Object} [options.theme]
 * @returns {Promise<{pageCount: number, pages: Array<{width: number, height: number}>}>}
 */
export async function measureDeckPdf(repoRoot, deck, { theme = null } = {}) {
  const buf = Buffer.from(await renderSlidesToPdfBuffer(repoRoot, deck, { theme }));
  const parsed = await parsePdf(buf);

  // Page geometry comes from the /MediaBox entries rather than the text
  // extractor, which reports content and not size. Chrome writes the page dicts
  // uncompressed, so a scan over the raw bytes is enough and costs no
  // dependency.
  const mediaBoxes = [...buf.toString('latin1').matchAll(/\/MediaBox\s*\[([^\]]*)\]/g)].map((m) => {
    const [x0, y0, x1, y1] = m[1].trim().split(/\s+/).map(Number);
    return { width: round1(x1 - x0), height: round1(y1 - y0) };
  });

  return {
    pageCount: parsed.slides.length,
    parseErrors: parsed.errors,
    pages: mediaBoxes,
    pageText: parsed.slides.map((p) =>
      String(p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    ),
  };
}
