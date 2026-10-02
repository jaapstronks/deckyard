/**
 * An image as PPTX wants it: real raster bytes plus the pixel size they have.
 *
 * Both halves exist because pptxgenjs 4.0.1 gets them wrong on its own, as the
 * B232 spike measured. An SVG is written twice, the second time as a "PNG"
 * fallback that is the same SVG bytes, which every renderer but PowerPoint
 * draws as a broken-image box; so an SVG is rasterized here. And the library
 * never reads an image's intrinsic size — its `sizing` option takes the box you
 * gave it *as* the image size, so `contain` stretches — so the size is read
 * here and the caller fits the frame to it.
 *
 * Shared by the theme's mark (`pptx-theme.js`) and every picture the generic
 * composition places (`pptx-generic.js`): one route from a URL to bytes.
 */

import sharp from 'sharp';

import { toDataUrlIfLocal } from '../utils/html-utils.js';

/** Formats pptxgenjs embeds as they are; anything else is re-encoded as PNG. */
const PASSTHROUGH = new Set(['png', 'jpeg']);

/**
 * Read an image for the PPTX.
 *
 * A local asset is read from disk; a remote `http(s)` URL only when
 * `embedRemote` is set, and then through the SSRF guard. Anything unreadable
 * yields `null` rather than a broken reference: the caller decides what stands
 * in for a picture that could not travel.
 *
 * @param {string} repoRoot
 * @param {string} url - the image URL as the slide stores it
 * @param {{ maxPx: {w: number, h: number}, embedRemote?: boolean }} options -
 *   `maxPx` is the largest box the image will be drawn in, in pixels; the
 *   bytes are capped to it (and an SVG rendered to it)
 * @returns {Promise<{data: string, w: number, h: number}|null>} a data URL and
 *   the pixel size of the bytes in it
 */
export async function rasterForPptx(
  repoRoot,
  url,
  { maxPx, embedRemote = false },
) {
  if (!url) return null;
  let bytes;
  try {
    const dataUrl = await toDataUrlIfLocal(repoRoot, url, {
      embedRemote,
      transform: async (buf, ext) => {
        if (ext === 'svg' || ext === 'svg+xml') {
          // An SVG has no pixels of its own: render it at the size it will be
          // drawn, which is what a raster at this box would have.
          const out = await sharp(buf, { density: 288 })
            .resize({
              width: maxPx.w,
              height: maxPx.h,
              fit: 'inside',
              withoutEnlargement: false,
            })
            .png()
            .toBuffer();
          return { buf: out, mime: 'image/png' };
        }
        const img = sharp(buf);
        const meta = await img.metadata();
        const tooBig =
          (meta.width || 0) > maxPx.w || (meta.height || 0) > maxPx.h;
        if (!tooBig && PASSTHROUGH.has(String(meta.format))) {
          return { buf, mime: `image/${meta.format}` };
        }
        const resized = tooBig
          ? img.resize({
              width: maxPx.w,
              height: maxPx.h,
              fit: 'inside',
              withoutEnlargement: true,
            })
          : img;
        const out =
          meta.format === 'jpeg'
            ? await resized.jpeg().toBuffer()
            : await resized.png().toBuffer();
        return {
          buf: out,
          mime: meta.format === 'jpeg' ? 'image/jpeg' : 'image/png',
        };
      },
    });
    const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
    if (!m) return null;
    bytes = { mime: m[1], buf: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }

  let meta;
  try {
    meta = await sharp(bytes.buf).metadata();
  } catch {
    return null;
  }
  if (!meta?.width || !meta?.height) return null;
  return {
    data: `data:${bytes.mime};base64,${bytes.buf.toString('base64')}`,
    w: meta.width,
    h: meta.height,
  };
}

/**
 * The largest frame of an image's own ratio that fits a box, centred in it —
 * `object-fit: contain`, done by hand because pptxgenjs' `sizing` cannot.
 *
 * @param {{w: number, h: number}} pixels - the image's pixel size
 * @param {{x: number, y: number, w: number, h: number}} box - inches
 * @returns {{x: number, y: number, w: number, h: number}} inches
 */
export function containInBox(pixels, box) {
  const ratio = Math.min(box.w / pixels.w, box.h / pixels.h);
  const w = pixels.w * ratio;
  const h = pixels.h * ratio;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
