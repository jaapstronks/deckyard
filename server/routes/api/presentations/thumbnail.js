/**
 * Deck overview thumbnail (Fase B of the front-page-perf track).
 *
 * GET /api/presentations/:id/thumbnail[?v=<revision>]
 *
 * Serves a cached, server-rasterized WebP of slide 1 for the deck grid. Auth is
 * the same read-access gate as the deck itself — these are private author decks,
 * NOT the public OG previews. On a cache miss the request never blocks on
 * headless Chrome: it kicks generation off asynchronously and returns 404 so the
 * client shows a cheap placeholder and retries once.
 */

import { getPresentation } from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { createRouteContext } from '../../../utils/context.js';
import { loadTheme } from '../../../utils/themes.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  thumbCacheKey,
  readCachedThumbnail,
  requestThumbnailGeneration,
} from '../../../render/deck-thumbnail.js';
import { methodNotAllowed, notFound, unauthorized } from '../../../utils/http.js';

/**
 * Warm the deck-grid thumbnail cache for a presentation (fire-and-forget).
 * Called after a publish so the deck shows its raster on the next list load
 * instead of the 404→retry placeholder flash. Best-effort: any failure just
 * leaves the on-demand route to regenerate later. Uses slide 1 and the deck's
 * current revision, matching what {@link handlePresentationThumbnail} serves.
 *
 * @param {string} repoRoot
 * @param {object} pres - Full presentation (post-save, so the revision matches).
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
  { repoRoot, req, res, authedUser } = {},
  presentationId
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return methodNotAllowed(res, ['GET']);
  }

  const ctx = createRouteContext(authedUser);
  const pres = await getPresentation(repoRoot, presentationId);
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
  const { filename } = thumbCacheKey(pres, theme);

  const cached = await readCachedThumbnail(repoRoot, filename);
  if (cached) {
    // `?v=<revision>` busts this on edit, so a modest max-age is safe.
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': cached.length,
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(cached);
    return true;
  }

  // Cache miss: rasterize slide 1 in the background (deduped + throttled), never
  // on the request thread. Empty decks (no slide) just stay a placeholder.
  const firstSlide = Array.isArray(pres?.slides) ? pres.slides[0] : null;
  if (firstSlide && typeof firstSlide === 'object') {
    const slideTypes = await buildMergedSlideTypes(ctx);
    requestThumbnailGeneration(repoRoot, pres, firstSlide, theme, slideTypes);
  }

  // Not ready yet — `no-store` so the client's retry actually re-requests.
  res.writeHead(404, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ ok: false, error: 'thumbnail_pending' }));
  return true;
}
