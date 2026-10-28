import { mayOnPresentation } from '../../../services/presentations.js';
import { projectPresentationForAudience } from '../../../utils/public-output.js';
/**
 * Deck overview thumbnail (Fase B of the front-page-perf track).
 *
 * GET /api/presentations/:id/thumbnail
 *
 * Serves a cached, server-rasterized WebP of slide 1 for the deck grid. Auth is
 * the same read-access gate as the deck itself — these are private author decks,
 * NOT the public OG previews. On a cache miss the request never blocks on
 * headless Chrome: it kicks generation off asynchronously and falls back to the
 * deck's previous raster (stale-while-revalidate). With no raster at all the
 * 404 says which kind of nothing it is: `thumbnail_pending` with a
 * `Retry-After` while generation runs, `thumbnail_unavailable` with the reason
 * when it failed (remembered for a few minutes), the deck has no slides or its
 * stored theme cannot be loaded.
 * Contract and the client's side of it: docs/reference/deck-thumbnails.md.
 *
 * **Freshness is content-addressed, not time-boxed.** The URL is stable, so the
 * browser has to ask before reusing what it has; `Cache-Control: private,
 * no-cache` makes it ask and the `ETag` makes the answer a bodiless 304 as long
 * as slide 1 and the theme are unchanged. The tag is the cache filename, which
 * already *is* `sha1(deck | slide 1 | theme)` — nothing extra to hash, and a
 * stale raster is tagged with its own name so a 304 can never present a
 * one-edit-old raster as the current one. This replaces the `?v=<revision>`
 * buster the client used to append: a revision bumps on every save, including
 * the saves that leave slide 1 (and therefore the raster) untouched.
 */

import { loadThemeAssets } from '../../../utils/themes.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  thumbCacheKey,
  thumbnailSlide,
  readCachedThumbnail,
  readStaleThumbnail,
  requestThumbnailGeneration,
  thumbnailFailure,
} from '../../../render/deck-thumbnail.js';
import {
  jsonError,
  methodNotAllowed,
  matchesIfNoneMatch,
  notModified,
} from '../../../utils/http.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { isAppError } from '../../../utils/errors.js';

/** Cache directive for every raster this route serves. See the module note. */
const THUMB_CACHE_CONTROL = 'private, no-cache';

/**
 * Seconds a `thumbnail_pending` answer asks the client to wait. A warm render
 * takes ~0.5 s; a cold Chromium in a small container takes seconds.
 */
const THUMB_RETRY_AFTER_S = 3;

export async function handlePresentationThumbnail(
  { repoRoot, storageScope, req, res, authedUser } = {},
  presentationId,
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return methodNotAllowed(res, ['GET']);
  }

  let pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
  });
  if (!pres) return true;
  const mayEdit = await mayOnPresentation(pres, { actor: authedUser }, 'write');
  const slideTypes = await buildMergedSlideTypes(storageScope);
  if (!mayEdit) {
    pres = projectPresentationForAudience(pres, {
      audience: 'reader',
      channel: 'viewer',
      slideTypes,
    });
    // Readers never share an author's cached raster, including pre-contract files.
    pres = { ...pres, id: `${pres.id}-reader-v2` };
  }

  // A stored theme that cannot load (a slug left from before the cutover,
  // B718; a record deleted under the deck) is not the request's fault: there
  // is no raster to make, so the card settles on its placeholder. The boot and
  // the doctor name the cutover command for the first case. Only the loader's
  // own refusal is that case; a database failure stays the 500 it is.
  let theme;
  try {
    theme = await loadThemeAssets(repoRoot, pres?.theme, storageScope);
  } catch (err) {
    if (!isAppError(err)) throw err;
    return jsonError(
      res,
      404,
      'thumbnail_unavailable',
      `The deck's theme cannot be loaded: ${err?.message || err}`,
    );
  }
  const { filename, prefix } = thumbCacheKey(pres, theme, slideTypes);

  /**
   * Send a raster, tagged with the cache file it came from. A conditional
   * request that already holds that exact file gets a 304 instead of the bytes.
   */
  const sendImage = (buffer, cacheFilename) => {
    const etag = `"${cacheFilename}"`;
    const revalidation = { ETag: etag, 'Cache-Control': THUMB_CACHE_CONTROL };
    if (matchesIfNoneMatch(req, etag)) return notModified(res, revalidation);
    res.writeHead(200, {
      ...revalidation,
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': buffer.length,
    });
    if (req.method === 'HEAD') res.end();
    else res.end(buffer);
    return true;
  };

  const cached = await readCachedThumbnail(repoRoot, filename);
  if (cached) return sendImage(cached, filename);

  // Cache miss: rasterize the first presentable slide in the background
  // (deduped + throttled), never on the request thread. A key whose last
  // attempt failed is not retried until the failure expires (deck-thumbnail.js).
  const firstSlide = thumbnailSlide(pres, slideTypes);
  const hasSlide = Boolean(firstSlide);
  if (hasSlide) {
    requestThumbnailGeneration(repoRoot, pres, firstSlide, theme, slideTypes);
  }

  // Slide 1 changed and the new raster isn't ready: serve the previous one
  // rather than a placeholder. The card is then at most one edit out of date,
  // and upgrades itself on the next load — which the stale file's own ETag
  // guarantees, since it stops matching the moment the fresh raster lands.
  const stale = mayEdit
    ? await readStaleThumbnail(repoRoot, prefix, filename)
    : null;
  if (stale) return sendImage(stale.buffer, stale.filename);

  // Nothing to show. Say which kind of nothing, so the card never has to
  // guess: "never" settles on the placeholder now, "not yet" waits as told.
  if (!hasSlide) {
    return jsonError(
      res,
      404,
      'thumbnail_unavailable',
      pres?.slides?.length
        ? 'No slide of this deck is ready to show yet.'
        : 'This deck has no slides.',
    );
  }
  const failure = thumbnailFailure(filename);
  if (failure) {
    return jsonError(res, 404, 'thumbnail_unavailable', failure);
  }
  return jsonError(res, 404, 'thumbnail_pending', undefined, {
    headers: { 'Retry-After': String(THUMB_RETRY_AFTER_S) },
  });
}
