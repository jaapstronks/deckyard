/**
 * Image downsampling / recompression for export embedding.
 *
 * The server-side PDF export inlines every image as a base64 data URL at full
 * resolution (see server/utils/html-utils.js `toDataUrlIfLocal`). A single
 * 4000px photo shown at 1600px therefore drags its full original pixels into
 * the PDF, which is why exports occasionally balloon to hundreds of MB.
 *
 * This module provides a transform that shrinks each raster image to a retina
 * margin over its display size and re-encodes it (JPEG for opaque images,
 * PNG when transparency must be preserved) before it is base64-encoded. SVGs
 * and animated GIFs are left untouched, and the transform never returns a
 * larger buffer than it was given.
 */

import sharp from 'sharp';

const DEFAULT_MAX_PX = 2600;
const DEFAULT_QUALITY = 80;

function parseIntEnv(raw, fallback, { min, max }) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/**
 * Read the PDF-export image-compression config from the environment.
 * Disabled entirely when `PDF_EXPORT_IMAGE_COMPRESSION` is a falsy string
 * ("0"/"off"/"false"/"no") or when `PDF_EXPORT_IMAGE_MAX_PX` is set to 0.
 *
 * @returns {{ maxPx: number, quality: number } | null} null when disabled.
 */
export function pdfImageCompressionConfig(env = process.env) {
  const toggle = String(env.PDF_EXPORT_IMAGE_COMPRESSION ?? '').trim().toLowerCase();
  if (['0', 'off', 'false', 'no'].includes(toggle)) return null;

  const maxPx = parseIntEnv(env.PDF_EXPORT_IMAGE_MAX_PX, DEFAULT_MAX_PX, {
    min: 0,
    max: 20000,
  });
  if (maxPx === 0) return null;

  const quality = parseIntEnv(env.PDF_EXPORT_IMAGE_QUALITY, DEFAULT_QUALITY, {
    min: 1,
    max: 100,
  });
  return { maxPx, quality };
}

// Extensions we never touch: vector (no raster resolution to trim) and
// animated GIFs (recompressing would flatten to a single frame).
const SKIP_EXTS = new Set(['svg', 'gif']);

/**
 * Downsample + recompress a raster image buffer for embedding.
 * Returns the original buffer/mime on any failure, on a skipped format, or
 * when the re-encoded result would be larger than the input.
 *
 * @param {Buffer} buf - Original image bytes
 * @param {string} ext - Lowercase file extension (no dot)
 * @param {string} mime - Original MIME type
 * @param {{ maxPx: number, quality: number }} config
 * @returns {Promise<{ buf: Buffer, mime: string }>}
 */
export async function compressImageForEmbed(buf, ext, mime, config) {
  const original = { buf, mime };
  if (!config || !Buffer.isBuffer(buf) || buf.length === 0) return original;
  if (SKIP_EXTS.has(String(ext || '').toLowerCase())) return original;

  try {
    const image = sharp(buf, { failOn: 'none' });
    const meta = await image.metadata();
    if (!meta || meta.format === 'svg' || meta.pages > 1) return original;

    const width = meta.width || 0;
    const height = meta.height || 0;
    if (!width || !height) return original;

    // Respect EXIF orientation so a resize doesn't bake in a rotated image.
    let pipeline = image.rotate();

    const longest = Math.max(width, height);
    if (longest > config.maxPx) {
      pipeline = pipeline.resize({
        width: width >= height ? config.maxPx : null,
        height: height > width ? config.maxPx : null,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    let out;
    let outMime;
    if (meta.hasAlpha) {
      // Preserve transparency: stay PNG, but re-encode at max deflate.
      out = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
      outMime = 'image/png';
    } else {
      out = await pipeline
        .jpeg({ quality: config.quality, mozjpeg: true })
        .toBuffer();
      outMime = 'image/jpeg';
    }

    // Never make an image bigger than it was (small/already-optimized assets).
    if (!out || out.length >= buf.length) return original;
    return { buf: out, mime: outMime };
  } catch {
    return original;
  }
}

/**
 * Build an embed-transform closure for the PDF path, or null when compression
 * is disabled. The returned function matches the `transform(buf, ext, mime)`
 * hook consumed by `toDataUrlIfLocal`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {((buf: Buffer, ext: string, mime: string) => Promise<{buf: Buffer, mime: string}>) | null}
 */
export function pdfImageEmbedTransform(env = process.env) {
  const config = pdfImageCompressionConfig(env);
  if (!config) return null;
  return (buf, ext, mime) => compressImageForEmbed(buf, ext, mime, config);
}
