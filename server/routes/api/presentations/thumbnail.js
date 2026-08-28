/**
 * Deck overview thumbnail (Fase B of the front-page-perf track).
 *
 * GET /api/presentations/:id/thumbnail
 *
 * Serves a cached, server-rasterized WebP of slide 1 for the deck grid. Auth is
 * the same read-access gate as the deck itself — these are private author decks,
 * NOT the public OG previews. On a cache miss the request never blocks on
 * headless Chrome: it kicks generation off asynchronously and falls back to the
 * deck's previous raster (stale-while-revalidate), or to a 404 → placeholder
 * when there is no previous one at all.
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

import { getPresentation } from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { loadThemeAssets } from '../../../utils/themes.js';
import { canReadPresentation } from '../../../utils/presentation-authz/index.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  thumbCacheKey,
  readCachedThumbnail,
  readStaleThumbnail,
  requestThumbnailGeneration,
} from '../../../render/deck-thumbnail.js';
import {
  methodNotAllowed,
  notFound,
  forbidden,
  matchesIfNoneMatch,
  notModified,
} from '../../../utils/http.js';

/** Cache directive for every raster this route serves. See the module note. */
const THUMB_CACHE_CONTROL = 'private, no-cache';

export async function handlePresentationThumbnail(
  { repoRoot, storageScope, req, res, authedUser } = {},
  presentationId,
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return methodNotAllowed(res, ['GET']);
  }

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);

  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email,
  );
  if (
    !canReadPresentation({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  const theme = await loadThemeAssets(repoRoot, pres?.theme);
  const { filename, prefix } = thumbCacheKey(pres, theme);

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

  // Cache miss: rasterize slide 1 in the background (deduped + throttled), never
  // on the request thread. Empty decks (no slide) just stay a placeholder.
  const firstSlide = Array.isArray(pres?.slides) ? pres.slides[0] : null;
  if (firstSlide && typeof firstSlide === 'object') {
    const slideTypes = await buildMergedSlideTypes(storageScope);
    requestThumbnailGeneration(repoRoot, pres, firstSlide, theme, slideTypes);
  }

  // Slide 1 changed and the new raster isn't ready: serve the previous one
  // rather than a placeholder. The card is then at most one edit out of date,
  // and upgrades itself on the next load — which the stale file's own ETag
  // guarantees, since it stops matching the moment the fresh raster lands.
  const stale = await readStaleThumbnail(repoRoot, prefix, filename);
  if (stale) return sendImage(stale.buffer, stale.filename);

  // Nothing to show yet — `no-store` so the client's retry actually re-requests.
  res.writeHead(404, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ ok: false, error: 'thumbnail_pending' }));
  return true;
}
