/**
 * Shared HTML utilities for export modules
 * Consolidates duplicate functions from export-html.js, export-pdf-slides.js,
 * render-png.js, export-png-slides.js, and export-print.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { SLIDE_TYPES } from '../../shared/slide-types.js';

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
 * @returns {Promise<string>} Data URL or original string
 */
export async function toDataUrlIfLocal(repoRoot, urlOrPath, { includeClient = false } = {}) {
  const s = String(urlOrPath || '');
  const isUpload = s.startsWith('/uploads/');
  const isAsset = s.startsWith('/assets/');
  const isClient = s.startsWith('/client/');
  // Fork assets: shared content under /custom/assets/, and per-theme assets
  // co-located under /custom/themes/<id>/assets/.
  const isCustom =
    s.startsWith('/custom/assets/') || s.startsWith('/custom/themes/');

  if (!isUpload && !isAsset && !isCustom && !(includeClient && isClient)) {
    return s;
  }

  const abs = isUpload
    ? path.join(repoRoot, 'server', 'uploads', s.replace('/uploads/', ''))
    : path.join(repoRoot, s.replace(/^\//, ''));

  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime = mimeFromExt(ext);
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
 * @returns {Promise<string>} HTML with embedded images
 */
export async function embedImgSrcDataUrls(repoRoot, html, { includeClient = false } = {}) {
  const s = String(html || '');
  const pattern = includeClient
    ? /\ssrc="(\/(?:uploads|assets|client|custom\/assets|custom\/themes)\/[^"]+)"/g
    : /\ssrc="(\/(?:uploads|assets|custom\/assets|custom\/themes)\/[^"]+)"/g;

  const matches = [...s.matchAll(pattern)];
  if (!matches.length) return s;

  const uniq = new Map();
  for (const m of matches) uniq.set(m[1], true);

  let out = s;
  for (const src of uniq.keys()) {
    const data = await toDataUrlIfLocal(repoRoot, src, { includeClient });
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
 * Embed all image field values as data URLs
 * @param {string} repoRoot - Repository root path
 * @param {Object} slide - Slide object (will be mutated)
 * @returns {Promise<Object>} The slide with embedded images
 */
export async function embedSlideImages(repoRoot, slide) {
  const imgKeys = imageFieldKeysForType(slide?.type);
  for (const k of imgKeys) {
    if (slide?.content?.[k]) {
      slide.content[k] = await toDataUrlIfLocal(repoRoot, slide.content[k], { includeClient: true });
    }
  }
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