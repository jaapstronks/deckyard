import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { dataDir } from '../../config/storage-paths.js';
import { logError } from '../../utils/logger.js';

/**
 * On-the-fly width variants for locally-stored uploads (`/uploads/…?w=<n>`).
 *
 * ImageKit-hosted assets get resized by their CDN (`?tr=w-…`, see
 * `client/lib/slide-runtime/thumb-image-resize.js`); local uploads have no such
 * transform, so the deck list would otherwise download full-resolution slide art
 * for every card. This handler intercepts `/uploads/…` requests that carry a
 * `?w=<n>` param, returns a sharp-resized, disk-cached variant, and leaves every
 * other request (no `w`, non-raster, unknown width, sharp missing) to fall
 * through to the normal static-file serving.
 *
 * Security/robustness:
 * - Width is allowlisted (not arbitrary) so an attacker can't fill the disk
 *   with unbounded distinct-width variants.
 * - The filesystem path reuses the same base-dir containment guard as the
 *   static-file route; anything escaping the uploads dir is rejected.
 * - The variant cache is keyed on source mtime, so replacing an upload in place
 *   regenerates rather than serving a stale crop.
 * - sharp is an optional dependency: if it (or the resize) fails we return false
 *   and the caller serves the original untouched.
 */

/** Widths we will materialize a variant for. Keeps the on-disk cache bounded. */
const ALLOWED_WIDTHS = new Set([400, 800, 1600]);

/** Extensions we can resize; everything else falls through to the original. */
const RESIZABLE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const OUTPUT_MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

let sharpMod;
/** Lazily import sharp; cache the result (or `null` when it's not installed). */
async function loadSharp() {
  if (sharpMod !== undefined) return sharpMod;
  try {
    const mod = await import('sharp');
    sharpMod = mod?.default || mod;
  } catch {
    sharpMod = null;
  }
  return sharpMod;
}

/** Resolve the uploads base dir from the shared public-dir table. */
function uploadsBaseDir(sharedPublicDirs) {
  const entry = (sharedPublicDirs || []).find((d) => d.urlPrefix === '/uploads/');
  return entry ? entry.dir : null;
}

/**
 * Resize `srcPath` to `width` and return the encoded buffer, or `null` if the
 * image can't/shouldn't be resized (multi-page, unreadable). The output format
 * is chosen from `ext` alone (png→png, webp→webp, else jpeg) so the cache
 * filename and content-type stay derivable without re-reading metadata.
 * @param {*} sharp
 * @param {string} srcPath
 * @param {string} ext - lowercase source extension (with dot)
 * @param {number} width
 * @returns {Promise<Buffer | null>}
 */
async function resizeToVariant(sharp, srcPath, ext, width) {
  const image = sharp(srcPath, { failOn: 'none' });
  const meta = await image.metadata();
  if (!meta || meta.format === 'svg' || (meta.pages && meta.pages > 1)) return null;

  // Respect EXIF orientation, only ever shrink, never upscale.
  let pipeline = image.rotate().resize({ width, withoutEnlargement: true });

  const format = formatFromExt(ext);
  if (format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9, palette: true });
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality: 80 });
  } else {
    pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true });
  }

  return pipeline.toBuffer();
}

/**
 * Serve a width-capped variant of a local upload, or fall through.
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if handled (a variant was written).
 */
export async function handleUploadVariant({ req, res, url, repoRoot, sharedPublicDirs }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!url.pathname.startsWith('/uploads/')) return false;

  const width = Number(url.searchParams.get('w'));
  if (!ALLOWED_WIDTHS.has(width)) return false;

  const base = uploadsBaseDir(sharedPublicDirs);
  if (!base) return false;

  // Same containment guard as the static-file route.
  let rel = url.pathname.slice('/uploads/'.length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep raw on malformed escapes */
  }
  const baseResolved = path.resolve(base);
  const srcPath = path.resolve(baseResolved, rel);
  if (srcPath !== baseResolved && !srcPath.startsWith(baseResolved + path.sep)) {
    return false;
  }

  const ext = path.extname(srcPath).toLowerCase();
  if (!RESIZABLE_EXTS.has(ext)) return false;

  let srcStat;
  try {
    srcStat = await fs.stat(srcPath);
    if (!srcStat.isFile()) return false;
  } catch {
    return false; // missing/unreadable: let the static route emit the 404.
  }

  const sharp = await loadSharp();
  if (!sharp) return false;

  const cacheDir = path.join(dataDir(repoRoot), 'thumb-variants');
  const hash = crypto.createHash('sha1').update(rel).digest('hex');
  // One variant per (file, width); source mtime is checked below to invalidate.
  const cachePath = path.join(cacheDir, `${hash}-w${width}${ext}`);

  const contentType = OUTPUT_MIME[formatFromExt(ext)];

  try {
    const cachedStat = await fs.stat(cachePath);
    if (cachedStat.mtimeMs >= srcStat.mtimeMs) {
      const buf = await fs.readFile(cachePath);
      sendVariant(res, req, buf, contentType);
      return true;
    }
  } catch {
    /* cache miss: generate below */
  }

  let buf;
  try {
    buf = await resizeToVariant(sharp, srcPath, ext, width);
  } catch (err) {
    logError('upload-variant', 'resize failed:', err);
    return false; // fall through to the original.
  }
  if (!buf) return false;

  // Best-effort cache write; a failure here just means we regenerate next time.
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cachePath, buf);
  } catch (err) {
    logError('upload-variant', 'cache write failed:', err);
  }

  sendVariant(res, req, buf, contentType);
  return true;
}

/** Map a source extension to the output format we chose for its cache file. */
function formatFromExt(ext) {
  if (ext === '.png') return 'png';
  if (ext === '.webp') return 'webp';
  return 'jpeg';
}

/**
 * Write a variant response with caching headers. Thumbnails tolerate a short
 * staleness window after an in-place replace, so a modest max-age is used
 * rather than `immutable`.
 */
function sendVariant(res, req, buf, contentType) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': buf.length,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(buf);
}
