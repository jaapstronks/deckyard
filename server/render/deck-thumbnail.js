import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { deckThumbsDir } from '../config/storage-paths.js';
import { renderSlideToPngBuffer } from './png.js';
import { createLogger } from '../utils/logger.js';
import { isSlideVisibleIn } from '../../shared/slide-visibility.js';

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
 * - **Remembers a failure, and says so.** When headless Chrome is missing or
 *   crashes, or the resize or cache write fails, generation returns false, logs
 *   the cause once and remembers a display reason per cache key for
 *   {@link FAILURE_TTL_MS} (see {@link thumbnailFailure}). Until then the route
 *   answers `thumbnail_unavailable` instead of `thumbnail_pending`, and no new
 *   launch is attempted for that key: a broken browser costs one launch per
 *   deck per TTL, not two per card per page load. Never throws to the caller.
 *
 * Which surfaces use this raster and which render live is decided in
 * docs/reference/deck-thumbnails.md.
 */

/** Served width; ~2.5× a ~320px card so it stays crisp on retina. */
const THUMB_WIDTH = 800;
/** Cap concurrent headless-Chrome renders so opening a cold list of N decks
 *  doesn't spawn N pages at once. */
const MAX_CONCURRENT = 3;

/** How long a failed generation is remembered before the next attempt. */
export const FAILURE_TTL_MS = 5 * 60 * 1000;

const cacheDir = deckThumbsDir;

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
 * The slide a deck's thumbnail is made of: its first slide a presentation
 * shows. A slide hidden from presenting, or one still incomplete (an empty
 * essential picture, B590), would put a frame on the card that no audience
 * ever sees.
 *
 * @param {object} presentation - Full presentation (needs `slides`).
 * @param {Record<string, object>} [slideTypes] - The deck organization's
 *   registry; core when omitted.
 * @returns {object|null} null when no slide is ready to show
 */
export function thumbnailSlide(presentation, slideTypes) {
  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];
  return (
    slides.find(
      (slide) =>
        slide &&
        typeof slide === 'object' &&
        isSlideVisibleIn(slide, 'presentation', { slideTypes }),
    ) || null
  );
}

/**
 * Signature of the slide the thumbnail is made of ({@link thumbnailSlide}),
 * for cheap "did the raster's input change?" checks on the save path —
 * comparing two signatures costs a hash, not a theme load or a render.
 *
 * @param {object} presentation - Full presentation (needs `slides`).
 * @param {Record<string, object>} [slideTypes] - As {@link thumbnailSlide}.
 * @returns {string}
 */
export function firstSlideSignature(presentation, slideTypes) {
  return hashOf(thumbnailSlide(presentation, slideTypes), 'noslide');
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
 * @param {Record<string, object>} [slideTypes] - As {@link thumbnailSlide}.
 * @returns {{ id: string, sig: string, prefix: string, filename: string }}
 */
export function thumbCacheKey(presentation, theme, slideTypes) {
  const id = String(presentation?.id || '');
  const slideSig = firstSlideSignature(presentation, slideTypes);
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

// ── Remembered failures ─────────────────────────────────────────────────────
const failures = new Map(); // filename -> { reason, until }
const warnedCacheDirs = new Set(); // one installation warning per path and process
const CACHE_WRITE_ERRORS = new Set(['EACCES', 'EROFS', 'ENOSPC']);

/**
 * The display reason the last generation for this cache key failed, or null
 * when it did not fail (or the failure is older than {@link FAILURE_TTL_MS}).
 *
 * @param {string} filename - As produced by {@link thumbCacheKey}.
 * @param {number} [now]
 * @returns {string|null}
 */
export function thumbnailFailure(filename, now = Date.now()) {
  const entry = failures.get(filename);
  if (!entry) return null;
  if (entry.until <= now) {
    failures.delete(filename);
    return null;
  }
  return entry.reason;
}

/**
 * Remember that generation for `filename` failed, and log the cause. An
 * attempt only runs once the previous failure for its key expired, so the log
 * carries one line per deck per TTL instead of one per request.
 *
 * @param {string} filename
 * @param {string} reason - Display sentence for the route's `message`.
 * @param {unknown} [err] - The underlying error, for the log only.
 */
function rememberFailure(filename, reason, err, { cacheDir = '' } = {}) {
  const now = Date.now();
  for (const [key, entry] of failures) {
    if (entry.until <= now) failures.delete(key);
  }
  failures.set(filename, { reason, until: now + FAILURE_TTL_MS });
  if (cacheDir && CACHE_WRITE_ERRORS.has(err?.code)) {
    if (warnedCacheDirs.has(cacheDir)) return;
    warnedCacheDirs.add(cacheDir);
    log.warn(
      `Thumbnail cache ${cacheDir} is not writable (${err.code}). Run npm run doctor and make this directory writable by the server user.`,
    );
    return;
  }
  log.warn(`${filename}: ${reason}`, err ? err?.message || String(err) : '');
}

/** Forget every remembered failure. Test seam. */
export function clearThumbnailFailures() {
  failures.clear();
  warnedCacheDirs.clear();
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
 * the render, resize or write fails, after remembering why.
 * @returns {Promise<boolean>}
 */
async function generateAndCache(
  repoRoot,
  filename,
  slide,
  theme,
  slideTypes,
  render,
) {
  let pngBuffer;
  try {
    pngBuffer = await render(repoRoot, slide, {
      scale: 1,
      theme,
      slideTypes,
    });
  } catch (err) {
    rememberFailure(
      filename,
      'The browser that renders thumbnails did not start or crashed.',
      err,
    );
    return false;
  }
  if (!pngBuffer) {
    rememberFailure(filename, 'Rendering slide 1 produced no image.');
    return false;
  }

  let out;
  try {
    out = await sharp(pngBuffer)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    rememberFailure(filename, 'The rendered slide could not be resized.', err);
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
    rememberFailure(
      filename,
      'The thumbnail cache directory is not writable.',
      err,
      { cacheDir: cacheDir(repoRoot) },
    );
    return false;
  }
  return true;
}

/**
 * Ensure a thumbnail exists for this deck, generating it asynchronously if not.
 * Deduped per cache-key (single-flight) and throttled by a concurrency gate, so
 * this is safe to fire per card without blocking the request. A key whose last
 * attempt failed less than {@link FAILURE_TTL_MS} ago is not retried.
 * Fire-and-forget: the returned promise is mostly for tests.
 *
 * @param {string} repoRoot
 * @param {object} presentation
 * @param {object} slide - The slide to rasterize ({@link thumbnailSlide}).
 * @param {object|null} theme
 * @param {object|null} slideTypes
 * @param {object} [options]
 * @param {typeof renderSlideToPngBuffer} [options.render] - Test seam.
 * @returns {Promise<boolean>} whether a raster now exists.
 */
export function requestThumbnailGeneration(
  repoRoot,
  presentation,
  slide,
  theme,
  slideTypes,
  { render = renderSlideToPngBuffer } = {},
) {
  const { filename } = thumbCacheKey(presentation, theme, slideTypes);
  if (inFlight.has(filename)) return inFlight.get(filename);
  if (thumbnailFailure(filename)) return Promise.resolve(false);

  const promise = (async () => {
    // Another request may have generated it between the route's read and here.
    if (await readCachedThumbnail(repoRoot, filename)) return true;
    await acquireSlot();
    let ok;
    try {
      ok = await generateAndCache(
        repoRoot,
        filename,
        slide,
        theme,
        slideTypes,
        render,
      );
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
      rememberFailure(filename, 'Generating the thumbnail failed.', err);
      return false;
    })
    .finally(() => {
      inFlight.delete(filename);
    });

  inFlight.set(filename, promise);
  return promise;
}
