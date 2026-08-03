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
import { FONT_SUBSETS } from '../../shared/theme-fonts.js';

/** The slide frame every export renders into. */
export const FRAME = { width: 1600, height: 900 };

/**
 * `unicode-range` in a form both sides of the browser boundary agree on.
 *
 * Chrome re-serialises what it parsed, dropping the leading zeros our declared
 * ranges are written with: `U+0000-00FF` comes back as `U+0-FF`. Running our
 * constants and Chrome's readback through the same normaliser is what lets a
 * loaded `FontFace` be labelled with the subset it came from.
 */
function normalizeUnicodeRange(range) {
  return String(range || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/(^|[+\-,])0+(?=[0-9A-F])/g, '$1');
}

/** `{ <normalized range>: 'latin' | 'latin-ext' }`, for labelling loaded faces. */
const SUBSET_LABELS = Object.fromEntries(
  FONT_SUBSETS.map(({ name, unicodeRange }) => [normalizeUnicodeRange(unicodeRange), name])
);

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

/**
 * A page's extracted text, reduced to the form that is actually compared.
 *
 * Two steps, and the order is the whole point.
 *
 * **Normalise, then slice.** Where pdf.js breaks a glyph run is a function of
 * font metrics, so the same word extracts as `Your` on one platform and
 * `Y our` on another — the CI runner did exactly that on the logo
 * placeholder's "Your logo here". Whitespace is therefore dropped entirely
 * rather than collapsed, because the split can land *inside* a word where
 * there was no space to collapse. Slicing first, as this used to, would let a
 * whitespace shift move the cut and change which characters survive it — the
 * assertion would then fail on content that never differed.
 *
 * Word boundaries are not what this is for. "The right text reached the page"
 * is.
 *
 * @param {string} text
 * @returns {string}
 */
function pageTextKey(text) {
  return String(text || '').replace(/\s+/g, '').slice(0, 80);
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
      ({ selectors: sels, frame, subsetLabels }) => {
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

        // Keyed by subset as well as family and weight. A curated family ships
        // as Google's disjoint `latin` / `latin-ext` pair, and keying on
        // `family weight` alone collapsed the two into one entry — so losing
        // the `latin-ext` file, which is every accented glyph, changed nothing
        // here. The subset label is what makes that visible.
        const loadedFonts = [...document.fonts]
          .filter((f) => f.status === 'loaded')
          .map((f) => {
            const range = String(f.unicodeRange || '')
              .toUpperCase()
              .replace(/\s+/g, '')
              .replace(/(^|[+\-,])0+(?=[0-9A-F])/g, '$1');
            return `${f.family} ${f.weight} [${subsetLabels[range] || range}]`;
          })
          .sort();

        return {
          elements,
          overflowing,
          slideBackground,
          loadedFonts: [...new Set(loadedFonts)],
        };
      },
      { selectors, frame: FRAME, subsetLabels: SUBSET_LABELS }
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

  // The scan is a heuristic over raw bytes; the page count is not. If they ever
  // disagree the geometry list is describing something other than the pages —
  // an inherited /MediaBox, a compressed page tree, a stray match inside a
  // stream — and a baseline recorded from it would be nonsense.
  if (mediaBoxes.length !== parsed.slides.length) {
    throw new Error(
      `/MediaBox scan found ${mediaBoxes.length} boxes for ${parsed.slides.length} pages — ` +
        'the raw-bytes scan no longer describes this PDF and the geometry cannot be trusted'
    );
  }

  return {
    pageCount: parsed.slides.length,
    parseErrors: parsed.errors,
    pages: mediaBoxes,
    pageText: parsed.slides.map((p) => pageTextKey(p.textContent)),
  };
}
