/**
 * Bulk export engine.
 * Collects all user presentations, optional versions, image library,
 * slide library, themes, and referenced images into a ZIP archive.
 */

import JSZip from 'jszip';
import { listPresentations, getPresentation } from '../storage/presentations.js';
import { listPresentationVersions, getPresentationVersion } from '../storage/presentations/versions.js';
import { listImageLibrary } from '../storage/image-library.js';
import { listPersonalLibrary, listTeamLibrary } from '../storage/slide-library.js';
import { listThemes } from '../storage/themes.js';
import { getDefaultOrganizationId } from '../config/database.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Simple concurrency limiter.
 * @param {number} limit - Max concurrent tasks
 * @returns {Function} acquire() that returns a release function
 */
function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  function release() {
    active--;
    if (queue.length > 0) {
      const next = queue.shift();
      active++;
      next();
    }
  }

  function acquire() {
    return new Promise((resolve) => {
      if (active < limit) {
        active++;
        resolve(release);
      } else {
        queue.push(() => resolve(release));
      }
    });
  }

  return acquire;
}

/**
 * Extract image URLs from a slide's content recursively.
 * Looks for bgImage, image, src, url, logoUrl fields.
 * @param {Object} obj - Slide content or nested object
 * @param {Set<string>} urls - Set to accumulate URLs into
 */
function extractImageUrls(obj, urls) {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) extractImageUrls(item, urls);
    return;
  }

  const urlFields = ['bgImage', 'image', 'src', 'url', 'logoUrl', 'imageUrl', 'logoSmallUrl'];
  for (const field of urlFields) {
    const val = obj[field];
    if (typeof val === 'string' && val.trim() && isImageUrl(val)) {
      urls.add(val.trim());
    }
  }

  // Recurse into nested objects
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      extractImageUrls(value, urls);
    }
  }
}

/**
 * Check if a string looks like an image URL.
 * @param {string} str
 * @returns {boolean}
 */
function isImageUrl(str) {
  if (!str) return false;
  // Must be http(s) or start with /
  if (!str.startsWith('http://') && !str.startsWith('https://') && !str.startsWith('/')) {
    return false;
  }
  // Skip data URIs (already embedded)
  if (str.startsWith('data:')) return false;
  return true;
}

/**
 * Derive a file extension from a URL or content-type.
 * @param {string} url
 * @param {string} [contentType]
 * @returns {string}
 */
function deriveExtension(url, contentType) {
  // Try from content-type
  if (contentType) {
    const type = contentType.split(';')[0].trim().toLowerCase();
    const map = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/avif': '.avif',
    };
    if (map[type]) return map[type];
  }

  // Try from URL path
  try {
    const pathname = new URL(url, 'http://localhost').pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'].includes(ext)) {
      return ext;
    }
  } catch {
    // ignore parse errors
  }

  return '.bin';
}

/**
 * Download a single image with timeout.
 * The timeout covers the entire request including body transfer,
 * so large images on slow connections are not left hanging.
 * @param {string} url - Image URL
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<{buffer: Buffer, contentType: string}|null>}
 */
async function downloadImage(url, timeout = 30000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Deckyard-Bulk-Export/1.0' },
    });

    if (!response.ok) {
      clearTimeout(timer);
      return null;
    }

    // Keep the abort timer active during body transfer — a server that
    // sends headers quickly but stalls on the body should still time out.
    const arrayBuffer = await response.arrayBuffer();
    clearTimeout(timer);

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') || '',
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a local image from disk.
 * Handles /uploads/, /assets/, /custom/assets/ and /custom/themes/ paths
 * following the same pattern as toDataUrlIfLocal() in server/utils/html-utils.js.
 * @param {string} repoRoot - Repository root path
 * @param {string} urlPath - Local URL path (e.g. /uploads/abc.png)
 * @returns {Promise<{buffer: Buffer, ext: string}|null>}
 */
async function resolveLocalImage(repoRoot, urlPath) {
  try {
    const isUpload = urlPath.startsWith('/uploads/');
    const isAsset = urlPath.startsWith('/assets/');
    // Fork assets: shared content under /custom/assets/, and per-theme assets
    // co-located under /custom/themes/<id>/assets/.
    const isCustom =
      urlPath.startsWith('/custom/assets/') ||
      urlPath.startsWith('/custom/themes/');

    if (!isUpload && !isAsset && !isCustom) return null;

    const abs = isUpload
      ? path.join(repoRoot, 'server', 'uploads', urlPath.replace('/uploads/', ''))
      : path.join(repoRoot, urlPath.replace(/^\//, ''));

    // Guard against path traversal (e.g. /uploads/../../etc/passwd)
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(path.resolve(repoRoot))) return null;

    const buffer = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase() || '.bin';
    return { buffer, ext };
  } catch {
    return null;
  }
}

/**
 * Build a bulk export ZIP and write it to a temp file.
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot - Repository root path
 * @param {string} opts.userEmail - Email of the exporting user
 * @param {string} [opts.organizationId] - Organization ID
 * @param {Object} [opts.options] - Export options
 * @param {boolean} [opts.options.includeVersions]
 * @param {boolean} [opts.options.includeImageLibrary]
 * @param {boolean} [opts.options.includeSlideLibrary]
 * @param {boolean} [opts.options.includeThemes]
 * @param {Function} [opts.onProgress] - Progress callback (0-100)
 * @returns {Promise<{filePath: string, manifest: Object}>}
 */
export async function buildBulkExport(opts) {
  const {
    repoRoot,
    userEmail,
    organizationId,
    options = {},
    onProgress = () => {},
  } = opts;

  const {
    includeVersions = false,
    includeImageLibrary = false,
    includeSlideLibrary = false,
    includeThemes = false,
  } = options;

  const zip = new JSZip();
  const manifest = {
    exportedAt: new Date().toISOString(),
    exportedBy: userEmail,
    stats: {},
    warnings: [],
  };

  const imageUrls = new Set();

  // ── 1. Collect presentations (0-15%) ────────────────────────
  await onProgress(2);

  const allPresentations = await listPresentations(repoRoot);
  const userPresentations = allPresentations.filter(
    (p) =>
      p.ownerEmail === userEmail ||
      p.createdBy === userEmail
  );

  const presentations = [];
  for (let i = 0; i < userPresentations.length; i++) {
    const summary = userPresentations[i];
    const full = await getPresentation(repoRoot, summary.id);
    if (!full) continue;

    zip.file(`presentations/${summary.id}.json`, JSON.stringify(full, null, 2));
    presentations.push({ id: summary.id, title: full.title || '' });

    // Extract image URLs from slides
    if (Array.isArray(full.slides)) {
      for (const slide of full.slides) {
        extractImageUrls(slide.content, imageUrls);
        extractImageUrls(slide, imageUrls);
      }
    }
    // Also check i18n versions for images
    if (full.i18n?.versions) {
      for (const langData of Object.values(full.i18n.versions)) {
        if (Array.isArray(langData.slides)) {
          for (const slide of langData.slides) {
            extractImageUrls(slide.content, imageUrls);
            extractImageUrls(slide, imageUrls);
          }
        }
      }
    }

    const pct = 2 + Math.round((i / userPresentations.length) * 13);
    await onProgress(Math.min(pct, 15));
  }

  manifest.stats.presentations = presentations.length;
  await onProgress(15);

  // ── 2. Collect versions (15-35%) ────────────────────────────
  let versionCount = 0;
  if (includeVersions) {
    for (let i = 0; i < presentations.length; i++) {
      const pres = presentations[i];
      const versions = await listPresentationVersions(repoRoot, pres.id);

      for (const ver of versions) {
        const full = await getPresentationVersion(repoRoot, pres.id, ver.id);
        if (!full) continue;
        zip.file(`versions/${pres.id}/${ver.id}.json`, JSON.stringify(full, null, 2));
        versionCount++;
      }

      const pct = 15 + Math.round((i / presentations.length) * 20);
      await onProgress(Math.min(pct, 35));
    }
  }
  manifest.stats.versions = versionCount;
  await onProgress(35);

  // ── 3. Collect image library (35-45%) ───────────────────────
  if (includeImageLibrary) {
    try {
      const images = await listImageLibrary(repoRoot);
      zip.file('image-library/index.json', JSON.stringify(images, null, 2));
      manifest.stats.imageLibraryItems = Array.isArray(images) ? images.length : 0;

      // Extract image URLs from library items
      if (Array.isArray(images)) {
        for (const img of images) {
          if (img.url) imageUrls.add(img.url);
        }
      }
    } catch (err) {
      manifest.warnings.push(`Image library: ${err.message}`);
    }
  }
  await onProgress(45);

  // ── 4. Collect slide library (45-50%) ───────────────────────
  if (includeSlideLibrary) {
    try {
      const personal = await listPersonalLibrary(repoRoot, userEmail);
      zip.file('slide-library/personal.json', JSON.stringify(personal, null, 2));
      manifest.stats.personalSlideLibraryItems = personal?.items?.length || 0;
    } catch (err) {
      manifest.warnings.push(`Personal slide library: ${err.message}`);
    }

    try {
      const team = await listTeamLibrary(repoRoot, { userEmail });
      zip.file('slide-library/team.json', JSON.stringify(team, null, 2));
      manifest.stats.teamSlideLibraryItems = team?.items?.length || 0;
    } catch (err) {
      manifest.warnings.push(`Team slide library: ${err.message}`);
    }
  }
  await onProgress(50);

  // ── 5. Collect themes (50-55%) ──────────────────────────────
  if (includeThemes) {
    try {
      const ctx = {
        organizationId: organizationId || getDefaultOrganizationId(),
        actorEmail: userEmail,
      };
      const themes = await listThemes(ctx);
      if (Array.isArray(themes)) {
        for (const theme of themes) {
          zip.file(`themes/${theme.id}.json`, JSON.stringify(theme, null, 2));
          // Extract logo URLs
          if (theme.logoUrl) imageUrls.add(theme.logoUrl);
          if (theme.logoSmallUrl) imageUrls.add(theme.logoSmallUrl);
        }
        manifest.stats.themes = themes.length;
      }
    } catch (err) {
      manifest.warnings.push(`Themes: ${err.message}`);
    }
  }
  await onProgress(55);

  // ── 6. Resolve referenced images (55-85%) ──────────────────
  const allUrls = [...imageUrls];
  const localUrls = allUrls.filter((u) => u.startsWith('/'));
  const remoteUrls = allUrls.filter(
    (u) => u.startsWith('http://') || u.startsWith('https://')
  );

  const imageMap = new Map(); // url -> { hash, ext, filename }
  let downloaded = 0;
  let downloadFailed = 0;
  let localResolved = 0;
  let localFailed = 0;

  // 6a. Resolve local images from disk (no network, no semaphore)
  for (const url of localUrls) {
    const result = await resolveLocalImage(repoRoot, url);
    if (result) {
      const hash = crypto.createHash('sha256').update(result.buffer).digest('hex').slice(0, 16);
      const ext = result.ext;
      const filename = `${hash}${ext}`;

      if (!imageMap.has(url)) {
        imageMap.set(url, { hash, ext, filename });
        zip.file(`assets/${filename}`, result.buffer);
      }
      localResolved++;
    } else {
      localFailed++;
    }
  }

  // Progress after local images
  const localPct = localUrls.length > 0
    ? 55 + Math.round((localUrls.length / Math.max(allUrls.length, 1)) * 30)
    : 55;
  await onProgress(Math.min(localPct, 70));

  // 6b. Download remote images via fetch with concurrency limiter
  // Scale concurrency: 5 for small sets, up to 10 for large image sets
  const concurrency = remoteUrls.length > 50 ? 10 : 5;
  const acquire = createSemaphore(concurrency);

  await Promise.all(
    remoteUrls.map(async (url) => {
      const release = await acquire();
      try {
        const result = await downloadImage(url);
        if (result) {
          const hash = crypto.createHash('sha256').update(result.buffer).digest('hex').slice(0, 16);
          const ext = deriveExtension(url, result.contentType);
          const filename = `${hash}${ext}`;

          if (!imageMap.has(url)) {
            imageMap.set(url, { hash, ext, filename });
            zip.file(`assets/${filename}`, result.buffer);
          }
          downloaded++;
        } else {
          downloadFailed++;
        }
      } catch {
        downloadFailed++;
      } finally {
        release();
      }

      const total = remoteUrls.length;
      const done = downloaded + downloadFailed;
      const pct = localPct + Math.round((done / Math.max(total, 1)) * (85 - localPct));
      await onProgress(Math.min(pct, 85));
    })
  );

  manifest.stats.imagesLocal = localResolved;
  manifest.stats.imagesLocalFailed = localFailed;
  manifest.stats.imagesDownloaded = downloaded;
  manifest.stats.imagesFailed = downloadFailed;
  manifest.stats.imagesSkipped = imageUrls.size - localUrls.length - remoteUrls.length;

  // Build image URL mapping for reference
  if (imageMap.size > 0) {
    const urlMap = {};
    for (const [url, info] of imageMap) {
      urlMap[url] = `assets/${info.filename}`;
    }
    zip.file('assets/url-map.json', JSON.stringify(urlMap, null, 2));
  }

  await onProgress(85);

  // ── 7. Build ZIP to temp file (85-100%) ─────────────────────
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  await onProgress(90);

  const tmpPath = path.join(os.tmpdir(), `deckyard-export-${crypto.randomUUID()}.zip`);

  // Stream ZIP to temp file instead of holding in memory
  await new Promise((resolve, reject) => {
    const stream = zip.generateNodeStream({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      streamFiles: true,
    });
    const out = createWriteStream(tmpPath);
    stream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    stream.on('error', reject);
  });

  await onProgress(95);

  // Get file size and update manifest (not reflected in the in-ZIP manifest.json)
  const stat = await fs.stat(tmpPath);
  manifest.stats.totalSizeBytes = stat.size;

  // Add warnings for large exports
  if (stat.size > 500 * 1024 * 1024) {
    manifest.warnings.push(`Large export: ${(stat.size / (1024 * 1024)).toFixed(0)} MB`);
  }
  if (downloadFailed > 0) {
    manifest.warnings.push(`${downloadFailed} remote image(s) could not be downloaded`);
  }
  if (localFailed > 0) {
    manifest.warnings.push(`${localFailed} local image(s) could not be resolved`);
  }

  await onProgress(100);

  return { filePath: tmpPath, manifest };
}
