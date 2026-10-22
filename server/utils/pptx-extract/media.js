/**
 * The pictures of a slide as PNG, as the page model carries them (B828).
 *
 * A `p:pic` points through its slide's relationships at a media part. The
 * page model holds PNG bytes (the slide import uploads them as PNG), so a
 * PNG passes through and every other raster format `sharp` reads (JPEG,
 * GIF, WebP, TIFF) is converted. Vector and metafile formats (SVG, EMF, WMF)
 * and anything unreadable do not become a picture: the caller lists them
 * under `dropped` with their own reason, so the import can say so. Cropping
 * (`a:srcRect`) and picture effects are out of scope (brief track 1b).
 */

import sharp from 'sharp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const RASTER = new Set([
  'png',
  'jpg',
  'jpeg',
  'jpe',
  'gif',
  'webp',
  'tif',
  'tiff',
]);

/**
 * @typedef {{ png: Buffer, pixels: { width: number, height: number } } | { unsupported: string }} PictureData
 */

/**
 * Read one media part as PNG.
 *
 * @param {import('jszip')} zip
 * @param {string} target - the media part, e.g. `ppt/media/image1.jpeg`
 * @returns {Promise<PictureData>} `unsupported` names the format (the file
 *   extension) when it does not become a PNG
 */
export async function readPicture(zip, target) {
  const ext = (/\.([a-z0-9]+)$/i.exec(target)?.[1] || '').toLowerCase();
  const file = zip.file(target);
  if (!file || !RASTER.has(ext)) return { unsupported: ext || 'unknown' };
  try {
    const data = await file.async('nodebuffer');
    const image = sharp(data);
    const { width, height } = await image.metadata();
    const png = data.subarray(0, 4).equals(PNG_SIGNATURE)
      ? data
      : await image.png().toBuffer();
    return { png, pixels: { width, height } };
  } catch {
    return { unsupported: ext };
  }
}
