/**
 * Shared HTML utilities for export modules
 * Consolidates duplicate functions from export-html.js, export-pdf-slides.js,
 * render-png.js, export-png-slides.js, and export-print.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { isRemoteHttpUrl, safeFetchRemoteImage } from './ssrf-guard.js';
import { mapLimit, exportEmbedConcurrency } from './map-limit.js';

// Re-export from shared helpers
export { escapeHtml } from '../../shared/slide-types/helpers.js';

/**
 * Read a file, returning empty string if it doesn't exist
 * @param {string} p - File path
 * @returns {Promise<string>} File contents or empty string
 */
export async function readTextIfExists(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Get MIME type from file extension
 * @param {string} ext - File extension (without dot)
 * @returns {string} MIME type
 */
export function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  switch (e) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'avif':
      return 'image/avif';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Convert a local path to a data URL if it's an upload or asset
 * @param {string} repoRoot - Repository root path
 * @param {string} urlOrPath - URL or path to convert
 * @param {Object} options - Options
 * @param {boolean} options.includeClient - Also convert /client/ paths (default: false)
 * @param {(buf: Buffer, ext: string, mime: string) => Promise<{buf: Buffer, mime: string}>} [options.transform]
 *   Optional async transform applied to the image bytes before base64-encoding
 *   (e.g. downsample/recompress for PDF). Must resolve to `{ buf, mime }`.
 * @param {boolean} [options.embedRemote] When true, remote http(s) image URLs
 *   are fetched through the SSRF guard and inlined as data URLs; a blocked or
 *   failed fetch returns '' (stripped) so the URL never reaches headless Chrome.
 *   Only enable on server-side export/render paths. See security-hardening 2.
 * @param {Map<string, Promise<string>>} [options.cache] Optional per-export-run
 *   cache keyed by source URL/path. When supplied, the same source is fetched +
 *   recompressed at most once across every embed pass in the run (the in-flight
 *   promise is memoised, so concurrent callers dedupe too). Scope one Map to a
 *   single export run with a single transform config; do not share across runs.
 * @returns {Promise<string>} Data URL or original string
 */
export function toDataUrlIfLocal(repoRoot, urlOrPath, options = {}) {
  const s = String(urlOrPath || '');
  const cache = options.cache || null;
  if (cache) {
    const existing = cache.get(s);
    if (existing) return existing;
  }
  const promise = computeDataUrlIfLocal(repoRoot, s, options);
  if (cache) cache.set(s, promise);
  return promise;
}

/**
 * Async worker behind {@link toDataUrlIfLocal}. Kept separate so the public
 * function can memoise the returned promise synchronously (dedupe in-flight
 * fetches) before the first await.
 * @param {string} repoRoot
 * @param {string} s - Already-stringified URL or path
 * @param {Object} options - Same shape as toDataUrlIfLocal options (minus cache)
 * @returns {Promise<string>}
 */
async function computeDataUrlIfLocal(
  repoRoot,
  s,
  { includeClient = false, transform = null, embedRemote = false } = {},
) {
  const isUpload = s.startsWith('/uploads/');
  const isAsset = s.startsWith('/assets/');
  const isClient = s.startsWith('/client/');
  // Fork assets: shared content under /custom/assets/, and per-theme assets
  // co-located under /custom/themes/<id>/assets/.
  const isCustom =
    s.startsWith('/custom/assets/') || s.startsWith('/custom/themes/');

  if (!isUpload && !isAsset && !isCustom && !(includeClient && isClient)) {
    // Remote http(s) images: on export/render paths, inline through the SSRF
    // guard or strip. Everything else (data: URIs, other schemes) is untouched.
    if (embedRemote && isRemoteHttpUrl(s)) {
      const fetched = await safeFetchRemoteImage(s);
      if (!fetched) return '';
      let buf = fetched.buffer;
      let mime = fetched.contentType || 'application/octet-stream';
      const ext = mime.startsWith('image/') ? mime.slice(6) : '';
      if (typeof transform === 'function') {
        const r = await transform(buf, ext, mime);
        if (r && Buffer.isBuffer(r.buf)) {
          buf = r.buf;
          if (r.mime) mime = r.mime;
        }
      }
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
    return s;
  }

  const abs = isUpload
    ? path.join(repoRoot, 'server', 'uploads', s.replace('/uploads/', ''))
    : path.join(repoRoot, s.replace(/^\//, ''));

  try {
    let buf = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    let mime = mimeFromExt(ext);
    if (typeof transform === 'function') {
      const r = await transform(buf, ext, mime);
      if (r && Buffer.isBuffer(r.buf)) {
        buf = r.buf;
        if (r.mime) mime = r.mime;
      }
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return s;
  }
}

/**
 * Replace img src attributes with data URLs for local assets
 * @param {string} repoRoot - Repository root path
 * @param {string} html - HTML string
 * @param {Object} options - Options
 * @param {boolean} options.includeClient - Also convert /client/ paths (default: false)
 * @param {Function} [options.transform] - Optional image-bytes transform (see toDataUrlIfLocal)
 * @param {Map<string, Promise<string>>} [options.cache] - Optional per-run embed cache (see toDataUrlIfLocal)
 * @returns {Promise<string>} HTML with embedded images
 */
export async function embedImgSrcDataUrls(
  repoRoot,
  html,
  { includeClient = false, transform = null, embedRemote = false, cache = null } = {},
) {
  const s = String(html || '');
  const localPattern = includeClient
    ? /\ssrc="(\/(?:uploads|assets|client|custom\/assets|custom\/themes)\/[^"]+)"/g
    : /\ssrc="(\/(?:uploads|assets|custom\/assets|custom\/themes)\/[^"]+)"/g;

  const uniq = new Map();
  for (const m of s.matchAll(localPattern)) uniq.set(m[1], true);
  // Safety net: when inlining remote images, also catch raw remote <img src>
  // (e.g. from custom HTML) so no http(s) src reaches headless Chrome.
  if (embedRemote) {
    for (const m of s.matchAll(/\ssrc="(https?:\/\/[^"]+)"/gi)) {
      uniq.set(m[1], true);
    }
  }
  if (!uniq.size) return s;

  // Resolve every unique src concurrently (bounded), then apply all string
  // replacements once. Building the src->data map first avoids re-scanning
  // mutated output and partial-match races during parallel fetches.
  const srcs = [...uniq.keys()];
  const datas = await mapLimit(srcs, exportEmbedConcurrency(), (src) =>
    toDataUrlIfLocal(repoRoot, src, { includeClient, transform, embedRemote, cache }),
  );
  let out = s;
  for (let i = 0; i < srcs.length; i++) {
    const src = srcs[i];
    const data = datas[i];
    if (data !== src) {
      out = out.split(`src="${src}"`).join(`src="${data}"`);
    }
  }
  return out;
}

/**
 * Get image field keys for a slide type
 * @param {string} type - Slide type
 * @returns {string[]} Array of field keys that are images
 */
export function imageFieldKeysForType(type) {
  const def = SLIDE_TYPES?.[type];
  if (!def?.fields) return [];
  return def.fields
    .filter((f) => f?.type === 'image' && typeof f?.key === 'string')
    .map((f) => f.key);
}

/**
 * Image-typed keys inside a type's items arrays: [{ listKey, itemKeys }].
 * @param {string} type - Slide type
 * @returns {Array<{listKey: string, itemKeys: string[]}>}
 */
function itemsImageFieldKeysForType(type) {
  const def = SLIDE_TYPES?.[type];
  if (!def?.fields) return [];
  const out = [];
  for (const f of def.fields) {
    if (f?.type !== 'items' || !Array.isArray(f?.itemFields)) continue;
    const itemKeys = f.itemFields
      .filter((it) => it?.type === 'image' && typeof it?.key === 'string')
      .map((it) => it.key);
    if (itemKeys.length && typeof f?.key === 'string') {
      out.push({ listKey: f.key, itemKeys });
    }
  }
  return out;
}

/**
 * Embed all image field values as data URLs, including image-typed keys
 * inside items arrays (gallery images[], image-text images[], ...).
 * @param {string} repoRoot - Repository root path
 * @param {Object} slide - Slide object (will be mutated)
 * @param {Object} [options]
 * @param {Map<string, Promise<string>>} [options.cache] - Optional per-run embed cache (see toDataUrlIfLocal)
 * @returns {Promise<Object>} The slide with embedded images
 */
export async function embedSlideImages(repoRoot, slide, { cache = null } = {}) {
  // Collect every embed target as a {get, set} cell, then resolve them
  // concurrently. Order does not matter — each cell writes its own field.
  const cells = [];
  const imgKeys = imageFieldKeysForType(slide?.type);
  for (const k of imgKeys) {
    if (slide?.content?.[k]) {
      cells.push({ src: slide.content[k], set: (v) => { slide.content[k] = v; } });
    }
  }
  for (const { listKey, itemKeys } of itemsImageFieldKeysForType(slide?.type)) {
    const arr = slide?.content?.[listKey];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      for (const k of itemKeys) {
        if (item && typeof item === 'object' && item[k]) {
          cells.push({ src: item[k], set: (v) => { item[k] = v; } });
        }
      }
    }
  }
  await mapLimit(cells, exportEmbedConcurrency(), async (cell) => {
    cell.set(await toDataUrlIfLocal(repoRoot, cell.src, { includeClient: true, cache }));
  });
  return slide;
}

/**
 * Check if a string looks like a URL
 * @param {string} s - String to check
 * @returns {boolean} True if it looks like a URL
 */
export function isProbablyUrl(s) {
  const t = String(s || '').trim();
  return /^https?:\/\//i.test(t) || t.startsWith('//');
}