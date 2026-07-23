import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { dataDir } from '../config/storage-paths.js';
import { renderSlideToPngBuffer } from './png.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('deck-thumbnail');

/**
 * Server-side rasterized thumbnails for the deck overview grid (Fase B of the
 * front-page-perf track). The list used to render a full live slide DOM per
 * card; here we serve a cached PNG→WebP raster of slide 1 instead.
 *
 * Contract, deliberately kept simple because thumbnails are *nice to have*:
 * - **Never block a request on headless Chrome.** The route serves the cache if
 *   present and otherwise kicks generation off asynchronously (see
 *   {@link requestThumbnailGeneration}); the client shows a cheap placeholder
 *   and retries.
 * - **Cache-key = deck-id + revision + theme signature.** `revision` bumps on
 *   every deck save and rides in the thumbnail URL as `?v=`, so an edit changes
 *   the URL and the old raster ages out — no explicit invalidation bookkeeping.
 *   The theme is folded in too, so editing a custom theme regenerates as well.
 * - **Degrades to placeholders.** Both dependencies are optional: if headless
 *   Chrome or sharp is missing (or a render fails) generation returns false and
 *   the card just keeps its placeholder. Never throws to the caller.
 */

/** Served width; ~2.5× a ~320px card so it stays crisp on retina. */
const THUMB_WIDTH = 800;
/** Cap concurrent headless-Chrome renders so opening a cold list of N decks
 *  doesn't spawn N pages at once. */
const MAX_CONCURRENT = 3;

const cacheDir = (repoRoot) => path.join(dataDir(repoRoot), 'deck-thumbs');

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

/** Keep the id prefix filesystem-safe; the sha suffix carries uniqueness. */
function sanitizeId(id) {
  return String(id || 'deck').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * Compute the deterministic cache identity for a deck's thumbnail.
 * @param {object} presentation - Full presentation (needs `id`, `revision`, `theme`).
 * @param {object|null} theme - Resolved theme object, folded into the signature so
 *   a theme edit invalidates even when the deck revision hasn't moved.
 * @returns {{ id: string, sig: string, filename: string }}
 */
export function thumbCacheKey(presentation, theme) {
  const id = String(presentation?.id || '');
  const rev = Number(presentation?.revision) || 1;
  let themeSig;
  try {
    themeSig = crypto
      .createHash('sha1')
      .update(JSON.stringify(theme ?? presentation?.theme ?? null))
      .digest('hex')
      .slice(0, 12);
  } catch {
    themeSig = String(presentation?.theme || 'default');
  }
  const sig = crypto
    .createHash('sha1')
    .update(`${id}|${rev}|${themeSig}`)
    .digest('hex')
    .slice(0, 16);
  return { id, sig, filename: `${sanitizeId(id)}-${sig}.webp` };
}

/**
 * Read a cached thumbnail buffer by filename, or `null` on a cache miss.
 * @param {string} repoRoot
 * @param {string} filename - As produced by {@link thumbCacheKey}.
 * @returns {Promise<Buffer | null>}
 */
export async function readCachedThumbnail(repoRoot, filename) {
  try {
    return await fs.readFile(path.join(cacheDir(repoRoot), filename));
  } catch {
    return null;
  }
}

// ── Single-flight + a small concurrency gate ────────────────────────────────
const inFlight = new Map(); // filename -> Promise<boolean>
let active = 0;
const waiters = [];

function acquireSlot() {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    next(); // hand the slot straight to the next waiter
  } else {
    active--;
  }
}

/**
 * Rasterize `slide` and write the cached WebP. Returns false (never throws) when
 * a dependency is missing or a render fails, leaving the card on its placeholder.
 * @returns {Promise<boolean>}
 */
async function generateAndCache(repoRoot, filename, slide, theme, slideTypes) {
  const sharp = await loadSharp();
  if (!sharp) {
    // Without sharp we can't produce the deterministic WebP the route serves;
    // treat thumbnails as unavailable rather than serving mismatched bytes.
    return false;
  }

  let pngBuffer;
  try {
    pngBuffer = await renderSlideToPngBuffer(repoRoot, slide, { scale: 1, theme, slideTypes });
  } catch (err) {
    log.warn('png render failed (headless Chrome missing?):', err?.message);
    return false;
  }
  if (!pngBuffer) return false;

  let out;
  try {
    out = await sharp(pngBuffer)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    log.warn('resize failed:', err?.message);
    return false;
  }

  try {
    const dir = cacheDir(repoRoot);
    await fs.mkdir(dir, { recursive: true });
    // Write-then-rename so a concurrent reader never sees a half-written file.
    const tmp = path.join(dir, `.${filename}.${process.pid}.tmp`);
    await fs.writeFile(tmp, out);
    await fs.rename(tmp, path.join(dir, filename));
  } catch (err) {
    log.warn('cache write failed:', err?.message);
    return false;
  }
  return true;
}

/**
 * Ensure a thumbnail exists for this deck, generating it asynchronously if not.
 * Deduped per cache-key (single-flight) and throttled by a concurrency gate, so
 * this is safe to fire per card without blocking the request. Fire-and-forget:
 * the returned promise is mostly for tests.
 *
 * @param {string} repoRoot
 * @param {object} presentation
 * @param {object} slide - The slide to rasterize (slide 1).
 * @param {object|null} theme
 * @param {object|null} slideTypes
 * @returns {Promise<boolean>} whether a raster now exists.
 */
export function requestThumbnailGeneration(repoRoot, presentation, slide, theme, slideTypes) {
  const { filename } = thumbCacheKey(presentation, theme);
  if (inFlight.has(filename)) return inFlight.get(filename);

  const promise = (async () => {
    // Another request may have generated it between the route's read and here.
    if (await readCachedThumbnail(repoRoot, filename)) return true;
    await acquireSlot();
    try {
      return await generateAndCache(repoRoot, filename, slide, theme, slideTypes);
    } finally {
      releaseSlot();
    }
  })()
    .catch((err) => {
      log.warn('generation failed:', err?.message);
      return false;
    })
    .finally(() => {
      inFlight.delete(filename);
    });

  inFlight.set(filename, promise);
  return promise;
}
