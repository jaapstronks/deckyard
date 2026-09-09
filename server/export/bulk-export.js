/**
 * Bulk export engine.
 * Collects all user presentations, optional versions, image library,
 * slide library, themes, and referenced images into a ZIP archive.
 */

import JSZip from 'jszip';
import {
  listPresentations,
  getPresentation,
  listPresentationVersions,
  getPresentationVersion,
} from '../storage/presentations/index.js';
import { listImageLibrary } from '../storage/image-library.js';
import {
  listPersonalLibrary,
  listOrganizationLibrary,
} from '../storage/slide-library.js';
import { listThemes } from '../storage/themes.js';
import {
  UPLOADS_PREFIX,
  collectServedAssetRefs,
  isServedAssetRef,
  isUploadRef,
} from '../../shared/slide-types/deck-assets.js';
import { uploadsDir } from '../config/storage-paths.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { singleOrganizationScope } from '../storage/scope.js';
import { resolveIdentityByEmail } from '../storage/identity-resolver.js';
import { isOwnerOrCreator } from '../utils/presentation-authz/index.js';

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
    if (
      ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'].includes(ext)
    ) {
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
 *
 * Accepts exactly the class the collector produces — `isServedAssetRef`, the
 * one spelling of "a path this installation serves as an asset" — so the
 * walker and the resolver cannot drift apart. Uploads live in the
 * env/sandbox-aware `uploadsDir` (the same root the `.deck` bundle reads), the
 * other served trees under the repo root.
 * @param {string} repoRoot - Repository root path
 * @param {string} urlPath - Local URL path (e.g. /uploads/abc.png)
 * @returns {Promise<{buffer: Buffer, ext: string}|null>}
 */
async function resolveLocalImage(repoRoot, urlPath) {
  try {
    if (!isServedAssetRef(urlPath)) return null;

    const base = path.resolve(
      isUploadRef(urlPath) ? uploadsDir(repoRoot) : repoRoot,
    );
    const rel = isUploadRef(urlPath)
      ? urlPath.slice(UPLOADS_PREFIX.length)
      : urlPath.slice(1);
    const resolved = path.resolve(base, rel);

    // Guard against path traversal (e.g. /uploads/../../etc/passwd); the
    // predicate already refuses `..`, this keeps the resolved path inside
    // its own root regardless.
    if (!resolved.startsWith(base + path.sep)) return null;

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

  // A bulk export runs detached from any request, so the organization it exports
  // has to come from the caller. Falls back to the single organization, and refuses
  // to guess once an instance holds several.
  const storageScope = organizationId
    ? { repoRoot, organizationId, actorEmail: userEmail || null }
    : singleOrganizationScope(repoRoot, 'bulk export', {
        actorEmail: userEmail || null,
      });

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

  // "My decks" for a data export is an ownership question, so it is decided on
  // the stable `users.id` like every other one — resolved once here, since a
  // detached job has no request context to carry it. An exporter with no user
  // row (file mode, legacy) leaves the actor id-less and the match falls back
  // to the email identifier. See shared/identity-match.js.
  const exporterResolution = await resolveIdentityByEmail(userEmail);
  const exporter = { id: exporterResolution?.userId || null, email: userEmail };
  const allPresentations = await listPresentations(storageScope);
  const userPresentations = allPresentations.filter((p) =>
    isOwnerOrCreator(exporter, p),
  );

  const presentations = [];
  for (let i = 0; i < userPresentations.length; i++) {
    const summary = userPresentations[i];
    const full = await getPresentation(storageScope, summary.id);
    if (!full) continue;

    zip.file(`presentations/${summary.id}.json`, JSON.stringify(full, null, 2));
    presentations.push({ id: summary.id, title: full.title || '' });

    // The deck's own asset refs come from the one walker in
    // shared/slide-types/deck-assets.js — the same module the `.deck` bundle
    // uses, so a new or nested image field is found by both exports or by
    // neither. A backup is of *this* installation, so it takes the wider
    // served-path class (uploads + the fork/theme asset trees).
    for (const ref of collectServedAssetRefs(full)) imageUrls.add(ref);
    for (const langData of Object.values(full.i18n?.versions || {})) {
      for (const ref of collectServedAssetRefs(langData)) imageUrls.add(ref);
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
      const versions = await listPresentationVersions(storageScope, pres.id);

      for (const ver of versions) {
        const full = await getPresentationVersion(
          storageScope,
          pres.id,
          ver.id,
        );
        if (!full) continue;
        zip.file(
          `versions/${pres.id}/${ver.id}.json`,
          JSON.stringify(full, null, 2),
        );
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
      const images = await listImageLibrary(storageScope);
      zip.file('image-library/index.json', JSON.stringify(images, null, 2));
      manifest.stats.imageLibraryItems = Array.isArray(images)
        ? images.length
        : 0;

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
      const personal = await listPersonalLibrary(storageScope, userEmail);
      zip.file(
        'slide-library/personal.json',
        JSON.stringify(personal, null, 2),
      );
      manifest.stats.personalSlideLibraryItems = personal?.items?.length || 0;
    } catch (err) {
      manifest.warnings.push(`Personal slide library: ${err.message}`);
    }

    try {
      const organization = await listOrganizationLibrary(storageScope, {
        userEmail,
      });
      zip.file(
        'slide-library/organization.json',
        JSON.stringify(organization, null, 2),
      );
      manifest.stats.organizationSlideLibraryItems =
        organization?.items?.length || 0;
    } catch (err) {
      manifest.warnings.push(`Organization slide library: ${err.message}`);
    }
  }
  await onProgress(50);

  // ── 5. Collect themes (50-55%) ──────────────────────────────
  if (includeThemes) {
    try {
      // Reuse the scope resolved above rather than rebuilding one: it already
      // carries the caller's organization (or the single-organization default via
      // singleOrganizationScope, which refuses to guess on a multi-organization
      // instance) instead of silently falling back to the default organization.
      const ctx = {
        organizationId: storageScope.organizationId,
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
    (u) => u.startsWith('http://') || u.startsWith('https://'),
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
      const hash = crypto
        .createHash('sha256')
        .update(result.buffer)
        .digest('hex')
        .slice(0, 16);
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
  const localPct =
    localUrls.length > 0
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
          const hash = crypto
            .createHash('sha256')
            .update(result.buffer)
            .digest('hex')
            .slice(0, 16);
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
      const pct =
        localPct + Math.round((done / Math.max(total, 1)) * (85 - localPct));
      await onProgress(Math.min(pct, 85));
    }),
  );

  manifest.stats.imagesLocal = localResolved;
  manifest.stats.imagesLocalFailed = localFailed;
  manifest.stats.imagesDownloaded = downloaded;
  manifest.stats.imagesFailed = downloadFailed;
  manifest.stats.imagesSkipped =
    imageUrls.size - localUrls.length - remoteUrls.length;

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

  const tmpPath = path.join(
    os.tmpdir(),
    `deckyard-export-${crypto.randomUUID()}.zip`,
  );

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
    manifest.warnings.push(
      `Large export: ${(stat.size / (1024 * 1024)).toFixed(0)} MB`,
    );
  }
  if (downloadFailed > 0) {
    manifest.warnings.push(
      `${downloadFailed} remote image(s) could not be downloaded`,
    );
  }
  if (localFailed > 0) {
    manifest.warnings.push(
      `${localFailed} local image(s) could not be resolved`,
    );
  }

  await onProgress(100);

  return { filePath: tmpPath, manifest };
}
