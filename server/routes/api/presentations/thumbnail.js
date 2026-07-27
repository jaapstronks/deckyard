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
import { createRouteContext } from '../../../utils/context.js';
import { loadTheme } from '../../../utils/themes.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  thumbCacheKey,
  readCachedThumbnail,
  readStaleThumbnail,
  requestThumbnailGeneration,
} from '../../../render/deck-thumbnail.js';
import { methodNotAllowed, notFound, unauthorized } from '../../../utils/http.js';

/**
 * Warm the deck-grid thumbnail cache for a presentation (fire-and-forget).
 * Called after a publish, so the deck shows its raster on the next list load
 * instead of making that load the trigger. Saves deliberately do *not* warm:
 * an unthrottled render on the autosave path costs a headless-Chrome launch
 * per keystroke-batch, and the stale-while-revalidate fallback already keeps
 * the card filled. Best-effort: any failure just leaves the on-demand route to
 * regenerate later. Uses slide 1, matching what
 * {@link handlePresentationThumbnail} serves.
 *
 * @param {string} repoRoot
 * @param {object} pres - Full presentation, post-save.
 * @param {object|null} authedUser
 * @returns {Promise<void>}
 */
export async function warmDeckThumbnail(repoRoot, pres, authedUser) {
  try {
    const slide = Array.isArray(pres?.slides) ? pres.slides[0] : null;
    if (!slide || typeof slide !== 'object') return;
    const ctx = createRouteContext(authedUser);
    const theme = await loadTheme(repoRoot, pres?.theme);
    const slideTypes = await buildMergedSlideTypes(ctx);
    await requestThumbnailGeneration(repoRoot, pres, slide, theme, slideTypes);
  } catch {
    // best-effort: the on-demand route regenerates on next request
  }
}

export async function handlePresentationThumbnail(
  { repoRoot, storageScope, req, res, authedUser } = {},
  presentationId
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return methodNotAllowed(res, ['GET']);
  }

  const ctx = createRouteContext(authedUser);
  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);

  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email,
    ctx
  );
  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  const theme = await loadTheme(repoRoot, pres?.theme);
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
    const slideTypes = await buildMergedSlideTypes(ctx);
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
