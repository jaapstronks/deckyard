import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
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
 * - **Cache-key = deck-id + slide-1 signature + theme signature.** The key hashes
 *   what the raster is actually made of, so an edit anywhere *else* in the deck
 *   doesn't invalidate it. Keying on the deck `revision` (which bumps on every
 *   save) meant opening and closing a deck was enough for a guaranteed miss, and
 *   a miss costs the card a ~10s placeholder shimmer.
 * - **Stale-while-revalidate.** When slide 1 genuinely did change, the previous
 *   raster for that deck is served while the new one renders in the background,
 *   so a card is never empty just because it is one edit out of date.
 * - **Warmed off the request path.** Publishing warms immediately; a save warms
 *   through the debounce in ./thumbnail-warm-queue.js, and only when it actually
 *   changed slide 1. Warming a deck on every save would put a Chrome render on
 *   the autosave treadmill.
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

/** Keep the id prefix filesystem-safe; the sha suffix carries uniqueness. */
function sanitizeId(id) {
  return String(id || 'deck')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

/** Stable sha1 prefix of any JSON-able value, with a caller-supplied fallback. */
function hashOf(value, fallback) {
  try {
    return crypto
      .createHash('sha1')
      .update(JSON.stringify(value ?? null))
      .digest('hex')
      .slice(0, 12);
  } catch {
    return fallback;
  }
}

/**
 * Signature of the slide the thumbnail is made of (slide 1), for cheap
 * "did the raster's input change?" checks on the save path — comparing two
 * signatures costs a hash, not a theme load or a render.
 *
 * @param {object} presentation - Full presentation (needs `slides`).
 * @returns {string}
 */
export function firstSlideSignature(presentation) {
  const firstSlide = Array.isArray(presentation?.slides)
    ? presentation.slides[0]
    : null;
  return hashOf(firstSlide, 'noslide');
}

/**
 * Compute the deterministic cache identity for a deck's thumbnail.
 *
 * Keyed on the raster's actual inputs — slide 1 and the resolved theme — rather
 * than on the deck `revision`. A revision bumps on every save, including saves
 * that never touch slide 1, so keying on it guaranteed a cache miss (and a
 * placeholder shimmer) after any edit anywhere in the deck.
 *
 * @param {object} presentation - Full presentation (needs `id`, `slides`, `theme`).
 * @param {object|null} theme - Resolved theme object, folded into the signature so
 *   a theme edit invalidates too.
 * @returns {{ id: string, sig: string, prefix: string, filename: string }}
 */
export function thumbCacheKey(presentation, theme) {
  const id = String(presentation?.id || '');
  const slideSig = firstSlideSignature(presentation);
  const themeSig = hashOf(
    theme ?? presentation?.theme ?? null,
    String(presentation?.theme || 'default'),
  );
  const sig = crypto
    .createHash('sha1')
    .update(`${id}|${slideSig}|${themeSig}`)
    .digest('hex')
    .slice(0, 16);
  const prefix = sanitizeId(id);
  return { id, sig, prefix, filename: `${prefix}-${sig}.webp` };
}

/**
 * Newest cached raster for a deck other than `exceptFilename`, or null.
 *
 * Backs the stale-while-revalidate path: when slide 1 really did change, the
 * card shows the previous raster (at most one edit old) instead of flashing a
 * placeholder for as long as headless Chrome needs.
 *
 * @param {string} repoRoot
 * @param {string} prefix - Filesystem-safe deck id, from {@link thumbCacheKey}.
 * @param {string} exceptFilename - The fresh key, which we already know is absent.
 * @returns {Promise<{ buffer: Buffer, filename: string } | null>}
 */
export async function readStaleThumbnail(repoRoot, prefix, exceptFilename) {
  const dir = cacheDir(repoRoot);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  const candidates = names.filter(
    (n) =>
      n.startsWith(`${prefix}-`) && n.endsWith('.webp') && n !== exceptFilename,
  );
  let newest = null;
  for (const name of candidates) {
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (!newest || stat.mtimeMs > newest.mtimeMs)
        newest = { name, mtimeMs: stat.mtimeMs };
    } catch {
      // raced with a prune; skip
    }
  }
  if (!newest) return null;
  try {
    return {
      buffer: await fs.readFile(path.join(dir, newest.name)),
      filename: newest.name,
    };
  } catch {
    return null;
  }
}

/**
 * Drop this deck's cached rasters, optionally sparing the current one.
 *
 * Two callers, one rule — a raster only exists to be served for a deck that
 * still exists, in the shape slide 1 currently has:
 * - after a successful render, `keep` is the fresh file, so the cache dir stops
 *   growing by one file per slide-1 edit;
 * - after a permanent delete there is nothing left to keep, so every raster for
 *   the id goes and no orphans survive the deck.
 *
 * @param {string} repoRoot
 * @param {string} deckId - Presentation id; sanitized to the cache prefix here.
 * @param {Object} [options]
 * @param {string|null} [options.keep] - Filename to spare, from {@link thumbCacheKey}.
 * @returns {Promise<void>}
 */
export async function pruneDeckThumbnails(
  repoRoot,
  deckId,
  { keep = null } = {},
) {
  const prefix = sanitizeId(deckId);
  const dir = cacheDir(repoRoot);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter(
        (n) => n.startsWith(`${prefix}-`) && n.endsWith('.webp') && n !== keep,
      )
      .map((n) =>
        // Awaited, so not a fire-and-forget: a stale sibling that refuses to
        // go is a disk-fills-up signal, not something to swallow.
        fs.rm(path.join(dir, n), { force: true }).catch((err) => {
          log.warn(`stale thumbnail ${n} not removed:`, err?.message || err);
        }),
      ),
  );
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
  let pngBuffer;
  try {
    pngBuffer = await renderSlideToPngBuffer(repoRoot, slide, {
      scale: 1,
      theme,
      slideTypes,
    });
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
export function requestThumbnailGeneration(
  repoRoot,
  presentation,
  slide,
  theme,
  slideTypes,
) {
  const { filename } = thumbCacheKey(presentation, theme);
  if (inFlight.has(filename)) return inFlight.get(filename);

  const promise = (async () => {
    // Another request may have generated it between the route's read and here.
    if (await readCachedThumbnail(repoRoot, filename)) return true;
    await acquireSlot();
    let ok;
    try {
      ok = await generateAndCache(repoRoot, filename, slide, theme, slideTypes);
    } finally {
      releaseSlot();
    }
    // Prune only after the fresh raster landed, so the stale-while-revalidate
    // path always has something to serve until the replacement exists.
    if (ok)
      await pruneDeckThumbnails(repoRoot, presentation?.id, { keep: filename });
    return ok;
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
