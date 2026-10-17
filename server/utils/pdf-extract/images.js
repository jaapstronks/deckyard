/**
 * Raster images and vector paths of one PDF page, from its operator list
 * (B751).
 *
 * The walk tracks the current transformation matrix through `save`,
 * `restore` and `transform`. An image is drawn into the unit square under
 * that matrix, so its corners give its box on the page; pdf.js has already
 * decoded the pixels (`page.objs`), which `sharp` encodes to PNG. No canvas
 * and no browser are involved.
 *
 * Handled: `paintImageXObject` and `paintInlineImageXObject`. Skipped on
 * purpose: `paintImageXObjectRepeat` (one image tiled at many positions, a
 * pattern rather than a picture) and image masks (a stencil, no pixels).
 */

import sharp from 'sharp';

import { OPS } from './pdfjs.js';

/** Images smaller than this on either side (in pixels) are icons or bullets. */
export const MIN_IMAGE_PIXELS = 40;

/** pdf.js `ImageKind` → channels per pixel (1 is 1 bit per pixel). */
const CHANNELS = { 1: 1, 2: 3, 3: 4 };

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

/**
 * @typedef {object} PageImage
 * @property {Buffer} png
 * @property {{ x: number, y: number, width: number, height: number }} box -
 *   page units, origin top-left, clipped to the page
 * @property {{ width: number, height: number }} pixels
 * @property {number | null} mcid - marked-content id of the paint operation
 */

/**
 * Walk the operator list for images and paths.
 *
 * @param {object} page - a pdf.js page (for `objs` / `commonObjs`)
 * @param {{ fnArray: number[], argsArray: any[] }} operatorList
 * @param {{ convertToViewportPoint: Function, width: number, height: number }} viewport
 * @returns {Promise<{ images: PageImage[], paths: number, pathBoxes: Array<{ x: number, y: number, width: number, height: number }> }>}
 */
export async function readPageGraphics(page, operatorList, viewport) {
  const { fnArray, argsArray } = operatorList;
  const pageBox = { width: viewport.width, height: viewport.height };
  const pageArea = pageBox.width * pageBox.height;
  const ctmStack = [];
  const mcStack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let paths = 0;
  const pathBoxes = [];
  const images = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) ctmStack.push(ctm);
    else if (fn === OPS.restore) ctm = ctmStack.pop() || ctm;
    else if (fn === OPS.transform) ctm = multiplyMatrix(ctm, args);
    else if (fn === OPS.beginMarkedContentProps)
      mcStack.push(args?.[1] ?? null);
    else if (fn === OPS.beginMarkedContent) mcStack.push(null);
    else if (fn === OPS.endMarkedContent) mcStack.pop();
    else if (fn === OPS.constructPath) {
      paths += 1;
      const minMax = args?.[2];
      if (minMax && [0, 1, 2, 3].every((k) => Number.isFinite(minMax[k]))) {
        const box = clipToPage(
          rectToPageBox(
            ctm,
            [minMax[0], minMax[1], minMax[2], minMax[3]],
            viewport,
          ),
          pageBox,
        );
        if (box && box.width * box.height < 0.5 * pageArea) pathBoxes.push(box);
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
        mcid: mcStack.findLast((m) => m !== null && m !== undefined) ?? null,
      });
    }
  }
  return { images, paths, pathBoxes };
}
