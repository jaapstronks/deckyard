/**
 * Raster images, vector paths and colour of one PDF page, from its operator
 * list (B751, colour since B827).
 *
 * The walk tracks the current transformation matrix through `save`,
 * `restore` and `transform`, and the fill and stroke colour through the
 * colour operators. An image is drawn into the unit square under that
 * matrix, so its corners give its box on the page; pdf.js has already
 * decoded the pixels (`page.objs`), which `sharp` encodes to PNG. No canvas
 * and no browser are involved.
 *
 * Colour comes out three ways: each path carries the colour it was painted
 * with, the page's background is the last solid fill that covers the page
 * (a pattern painted over it, such as the texture on a dark Deckyard slide,
 * does not change it), and every `showText` is recorded with the fill colour
 * in force, in content order, so `text-runs.js` can give each text run its
 * colour.
 *
 * Handled: `paintImageXObject` and `paintInlineImageXObject`. Skipped on
 * purpose: `paintImageXObjectRepeat` (one image tiled at many positions, a
 * pattern rather than a picture) and image masks (a stencil, no pixels).
 */

import sharp from 'sharp';

import { OPS } from './pdfjs.js';
import { boxArea } from './boxes.js';

/** Images smaller than this on either side (in pixels) are icons or bullets. */
export const MIN_IMAGE_PIXELS = 40;

/**
 * A solid fill that covers at least this fraction of the page is the page's
 * background. Measured (brief § Meting track 1b): PowerPoint paints its page
 * colour as one rectangle at 100%; Deckyard's own export paints white, then
 * the slide colour, each at 100%.
 */
export const BACKGROUND_MIN_COVERAGE = 0.8;

/**
 * The colour of a page nothing paints over: a PDF page is imaged on a white
 * medium. Chrome prints a page without a CSS background this way.
 */
export const PAGE_WHITE = '#ffffff';

/** pdf.js `ImageKind` → channels per pixel (1 is 1 bit per pixel). */
const CHANNELS = { 1: 1, 2: 3, 3: 4 };

const FILL_OPS = new Set([
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);
const STROKE_OPS = new Set([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);
const FILL_COLOR_OPS = new Set([
  OPS.setFillRGBColor,
  OPS.setFillGray,
  OPS.setFillCMYKColor,
  OPS.setFillColor,
  OPS.setFillColorN,
]);
const STROKE_COLOR_OPS = new Set([
  OPS.setStrokeRGBColor,
  OPS.setStrokeGray,
  OPS.setStrokeCMYKColor,
  OPS.setStrokeColor,
  OPS.setStrokeColorN,
]);
const TEXT_OPS = new Set([
  OPS.showText,
  OPS.showSpacedText,
  OPS.nextLineShowText,
  OPS.nextLineSetSpacingShowText,
]);

/** Multiply two PDF matrices `[a, b, c, d, e, f]` (pdf.js `Util.transform`). */
export function multiplyMatrix(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * The page box (origin top-left, y down) of a rectangle given in the
 * coordinate space of `ctm`.
 *
 * @param {number[]} ctm
 * @param {[number, number, number, number]} rect - minX, minY, maxX, maxY
 * @param {{ convertToViewportPoint: (x: number, y: number) => number[] }} viewport
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function rectToPageBox(ctm, [x0, y0, x1, y1], viewport) {
  const corners = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x, y]) =>
    viewport.convertToViewportPoint(
      ctm[0] * x + ctm[2] * y + ctm[4],
      ctm[1] * x + ctm[3] * y + ctm[5],
    ),
  );
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Clip a box to the page; null when nothing of it is on the page.
 *
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {{ width: number, height: number }} page
 */
export function clipToPage(box, { width, height }) {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const right = Math.min(width, box.x + box.width);
  const bottom = Math.min(height, box.y + box.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The `#rrggbb` a colour operator sets, or null for a pattern or shading.
 *
 * pdf.js 5 hands every device colour over as one hex string (gray and CMYK
 * are converted in the worker); older builds gave a `Uint8ClampedArray` of
 * 0–255. A plain array with a fraction in it is read as 0–1 components. A
 * pattern (`setFillColorN` with a pattern) has no single colour.
 *
 * @param {any[] | undefined} args - the operator's arguments
 * @returns {string | null}
 */
export function colorFromArgs(args) {
  const value = args && args.length === 1 ? args[0] : args;
  if (typeof value === 'string') {
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  }
  if (!value || typeof value.length !== 'number' || value.length < 3) {
    return null;
  }
  const rgb = Array.from(value).slice(0, 3);
  if (!rgb.every(Number.isFinite)) return null;
  const fractions =
    Array.isArray(value) && rgb.some((c) => !Number.isInteger(c));
  const hex = rgb.map((c) => {
    const byte = Math.min(
      255,
      Math.max(0, Math.round(fractions ? c * 255 : c)),
    );
    return byte.toString(16).padStart(2, '0');
  });
  return `#${hex.join('')}`;
}

/** Expand 1-bit-per-pixel rows (bit set = white) to one byte per pixel. */
function expandOneBit({ data, width, height }) {
  const out = Buffer.alloc(width * height);
  const rowBytes = (width + 7) >> 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      out[y * width + x] = bit ? 255 : 0;
    }
  }
  return out;
}

/**
 * Encode a decoded pdf.js image object as PNG; null when it carries no
 * readable pixels.
 *
 * @param {{ width: number, height: number, kind: number, data?: Uint8Array | Uint8ClampedArray }} img
 * @returns {Promise<Buffer | null>}
 */
export async function imageObjectToPng(img) {
  const channels = CHANNELS[img?.kind];
  if (!channels || !img.data || !img.width || !img.height) return null;
  const { width, height } = img;
  let pixels;
  if (img.kind === 1) {
    if (img.data.length < ((width + 7) >> 3) * height) return null;
    pixels = expandOneBit(img);
  } else {
    if (img.data.length < width * height * channels) return null;
    pixels = Buffer.from(
      img.data.buffer,
      img.data.byteOffset,
      width * height * channels,
    );
  }
  return sharp(pixels, { raw: { width, height, channels } }).png().toBuffer();
}

/** Resolve an image object; `g_` ids live in the document-wide store. */
function readImageObject(page, id) {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  if (store.has(id)) return Promise.resolve(store.get(id));
  return new Promise((resolve) => store.get(id, resolve));
}

/** The text a `showText` draws: its glyphs' unicode, spacing numbers left out. */
function glyphText(args) {
  const glyphs = Array.isArray(args?.[0]) ? args[0] : [];
  let text = '';
  for (const glyph of glyphs) {
    if (glyph && typeof glyph === 'object') text += glyph.unicode ?? '';
  }
  return text;
}

/**
 * @typedef {object} PageImage
 * @property {Buffer} png
 * @property {{ x: number, y: number, width: number, height: number }} box -
 *   page units, origin top-left, clipped to the page
 * @property {{ width: number, height: number }} pixels
 * @property {number | null} mcid - marked-content id of the paint operation
 */

/**
 * One `constructPath` operation.
 *
 * @typedef {object} PagePath
 * @property {{ x: number, y: number, width: number, height: number } | null} box -
 *   its bounds clipped to the page; null when pdf.js gives none or nothing
 *   of it lies on the page
 * @property {string | null} color - `#rrggbb`: the fill colour of a filled
 *   path, the stroke colour of a stroked one; null for a clipping path or a
 *   pattern
 * @property {boolean} filled
 */

/**
 * A `showText` operation, in content order, with the fill colour in force.
 *
 * @typedef {object} TextPaint
 * @property {string} text - the glyphs' unicode
 * @property {string | null} color
 * @property {number | null} mcid - innermost marked-content id
 */

/**
 * Walk the operator list for images, paths and colour.
 *
 * @param {object} page - a pdf.js page (for `objs` / `commonObjs`)
 * @param {{ fnArray: number[], argsArray: any[] }} operatorList
 * @param {{ convertToViewportPoint: Function, width: number, height: number }} viewport
 * @returns {Promise<{ images: PageImage[], paths: PagePath[], background: { color: string } | null, textPaints: TextPaint[] }>}
 *   `background` is the colour of the last solid fill that covers the page
 *   (`BACKGROUND_MIN_COVERAGE`), `PAGE_WHITE` when no fill covers it, and
 *   null when only a pattern (no single colour) covers it
 */
export async function readPageGraphics(page, operatorList, viewport) {
  const { fnArray, argsArray } = operatorList;
  const pageBox = { width: viewport.width, height: viewport.height };
  const pageArea = pageBox.width * pageBox.height;
  const stateStack = [];
  const mcStack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let fill = null;
  let stroke = null;
  /** @type {string | null} the last solid fill that covered the page */
  let pageFill = null;
  let patternCovered = false;
  const paths = [];
  const images = [];
  const textPaints = [];
  const innermostMcid = () =>
    mcStack.findLast((m) => m !== null && m !== undefined) ?? null;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stateStack.push({ ctm, fill, stroke });
    else if (fn === OPS.restore) {
      ({ ctm, fill, stroke } = stateStack.pop() || { ctm, fill, stroke });
    } else if (fn === OPS.transform) ctm = multiplyMatrix(ctm, args);
    else if (FILL_COLOR_OPS.has(fn)) fill = colorFromArgs(args);
    else if (STROKE_COLOR_OPS.has(fn)) stroke = colorFromArgs(args);
    else if (fn === OPS.beginMarkedContentProps)
      mcStack.push(args?.[1] ?? null);
    else if (fn === OPS.beginMarkedContent) mcStack.push(null);
    else if (fn === OPS.endMarkedContent) mcStack.pop();
    else if (TEXT_OPS.has(fn)) {
      textPaints.push({
        text: glyphText(args),
        color: fill,
        mcid: innermostMcid(),
      });
    } else if (fn === OPS.constructPath) {
      // pdf.js 5 carries the painting operator as the first argument.
      const op = args?.[0];
      const filled = FILL_OPS.has(op);
      const minMax = args?.[2];
      let box = null;
      if (minMax && [0, 1, 2, 3].every((k) => Number.isFinite(minMax[k]))) {
        box = clipToPage(
          rectToPageBox(
            ctm,
            [minMax[0], minMax[1], minMax[2], minMax[3]],
            viewport,
          ),
          pageBox,
        );
      }
      const color = filled ? fill : STROKE_OPS.has(op) ? stroke : null;
      paths.push({ box, color, filled });
      if (filled && box && boxArea(box) >= BACKGROUND_MIN_COVERAGE * pageArea) {
        if (fill) pageFill = fill;
        else patternCovered = true;
      }
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject
    ) {
      const img =
        fn === OPS.paintImageXObject
          ? await readImageObject(page, args[0])
          : args[0];
      if (!img || Math.min(img.width, img.height) < MIN_IMAGE_PIXELS) continue;
      const box = clipToPage(
        rectToPageBox(ctm, [0, 0, 1, 1], viewport),
        pageBox,
      );
      if (!box) continue;
      const png = await imageObjectToPng(img);
      if (!png) continue;
      images.push({
        png,
        box,
        pixels: { width: img.width, height: img.height },
        mcid: innermostMcid(),
      });
    }
  }
  const background = pageFill
    ? { color: pageFill }
    : patternCovered
      ? null
      : { color: PAGE_WHITE };
  return { images, paths, background, textPaints };
}
