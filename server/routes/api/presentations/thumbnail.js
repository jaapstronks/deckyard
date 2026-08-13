/**
 * Deck overview thumbnail (Fase B of the front-page-perf track).
 *
 * GET /api/presentations/:id/thumbnail[?v=<revision>]
 *
 * Serves a cached, server-rasterized WebP of slide 1 for the deck grid. Auth is
 * the same read-access gate as the deck itself — these are private author decks,
 * NOT the public OG previews. On a cache miss the request never blocks on
 * headless Chrome: it kicks generation off asynchronously and falls back to the
 * deck's previous raster (stale-while-revalidate), or to a 404 → placeholder
 * when there is no previous one at all.
 *
 * `?v=` is only a browser-cache buster from the client; the server's own cache
 * key is derived from slide 1 and the theme, not from the deck revision.
 */

import { getPresentation } from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { loadThemeAssets } from '../../../utils/themes.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  thumbCacheKey,
  firstSlideSignature,
  readCachedThumbnail,
  readStaleThumbnail,
  requestThumbnailGeneration,
} from '../../../render/deck-thumbnail.js';
import { scheduleThumbnailWarm } from '../../../render/thumbnail-warm-queue.js';
import { methodNotAllowed, notFound, unauthorized } from '../../../utils/http.js';

/**
 * Warm the deck-grid thumbnail cache for a presentation (fire-and-forget).
 * Called after a publish, and — debounced, via
 * {@link scheduleDeckThumbnailWarm} — after a save that touched slide 1, so the
 * deck shows its raster on the next list load instead of making that load the
 * trigger. Best-effort: any failure just leaves the on-demand route to
 * regenerate later. Uses slide 1, matching what
 * {@link handlePresentationThumbnail} serves.
 *
 * @param {import('../../../storage/scope.js').StorageScope} scope - The request's storage scope
 * @param {object} pres - Full presentation, post-save.
 * @returns {Promise<void>}
 */
export async function warmDeckThumbnail(scope, pres) {
  try {
    const slide = Array.isArray(pres?.slides) ? pres.slides[0] : null;
    if (!slide || typeof slide !== 'object') return;
    const theme = await loadThemeAssets(scope.repoRoot, pres?.theme);
    const slideTypes = await buildMergedSlideTypes(scope);
    await requestThumbnailGeneration(scope.repoRoot, pres, slide, theme, slideTypes);
  } catch {
    // best-effort: the on-demand route regenerates on next request
  }
}

/**
 * Queue a debounced thumbnail warm after a save, but only when the save
 * actually changed slide 1.
 *
 * Both halves are load-bearing. The signature check keeps the 90% case free —
 * most saves edit a slide the card never shows, and since PR #422 those don't
 * invalidate the raster either, so there is nothing to warm. The debounce
 * (see server/render/thumbnail-warm-queue.js) keeps the remaining case off the
 * autosave treadmill: a typing burst on slide 1 collapses into one render once
 * the deck goes quiet.
 *
 * Returns immediately; the render happens later, on no request's thread.
 *
 * @param {object} params
 * @param {import('../../../storage/scope.js').StorageScope} params.scope - The request's storage scope
 * @param {object} params.before - Presentation as it was before the save.
 * @param {object} params.after - Presentation as stored after the save.
 * @returns {boolean} whether a warm is now pending for this deck.
 */
export function scheduleDeckThumbnailWarm({ scope, before, after } = {}) {
  const id = after?.id;
  if (!id) return false;
  if (firstSlideSignature(before) === firstSlideSignature(after)) return false;
  return scheduleThumbnailWarm(String(id), () => warmDeckThumbnail(scope, after));
}

export async function handlePresentationThumbnail(
  { repoRoot, storageScope, req, res, authedUser } = {},
  presentationId
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return methodNotAllowed(res, ['GET']);
  }

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);

  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email
  );
  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  const theme = await loadThemeAssets(repoRoot, pres?.theme);
  const { filename, prefix } = thumbCacheKey(pres, theme);

  /** Send a raster; `fresh` decides how long the browser may hold onto it. */
  const sendImage = (buffer, fresh) => {
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      // A stale raster is one edit behind, so let it revalidate quickly.
      'Cache-Control': fresh ? 'public, max-age=3600' : 'public, max-age=10',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': buffer.length,
    });
    if (req.method === 'HEAD') res.end();
    else res.end(buffer);
    return true;
  };

  const cached = await readCachedThumbnail(repoRoot, filename);
  if (cached) return sendImage(cached, true);

  // Cache miss: rasterize slide 1 in the background (deduped + throttled), never
  // on the request thread. Empty decks (no slide) just stay a placeholder.
  const firstSlide = Array.isArray(pres?.slides) ? pres.slides[0] : null;
  if (firstSlide && typeof firstSlide === 'object') {
    const slideTypes = await buildMergedSlideTypes(storageScope);
    requestThumbnailGeneration(repoRoot, pres, firstSlide, theme, slideTypes);
  }

  // Slide 1 changed and the new raster isn't ready: serve the previous one
  // rather than a placeholder. The card is then at most one edit out of date,
  // and upgrades itself on the next load.
  const stale = await readStaleThumbnail(repoRoot, prefix, filename);
  if (stale) return sendImage(stale.buffer, false);

  // Nothing to show yet — `no-store` so the client's retry actually re-requests.
  res.writeHead(404, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ ok: false, error: 'thumbnail_pending' }));
  return true;
}
