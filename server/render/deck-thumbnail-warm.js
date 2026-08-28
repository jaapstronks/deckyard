/**
 * Warming the deck-grid raster: the two entry points that put a thumbnail in
 * the cache *before* a list load asks for it.
 *
 * Publishing warms directly ({@link warmDeckThumbnail}); a save warms through
 * the debounce in ./thumbnail-warm-queue.js and only when it actually changed
 * slide 1 ({@link scheduleDeckThumbnailWarm}). Both live here rather than in
 * the route module: the publish service and the save route are callers of this
 * behaviour, not owners of it, and a service importing from a route was a
 * layering inversion.
 *
 * Everything here is best-effort and never throws to the caller — whatever a
 * warm misses, the on-demand route (server/routes/api/presentations/thumbnail.js)
 * regenerates on the next request.
 */

import { createLogger } from '../utils/logger.js';
import { loadThemeAssets } from '../utils/themes.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import {
  firstSlideSignature,
  requestThumbnailGeneration,
} from './deck-thumbnail.js';
import {
  scheduleThumbnailWarm,
  warmOnSaveEnabled,
} from './thumbnail-warm-queue.js';

const log = createLogger('deck-thumbnail-warm');

/**
 * Warm the deck-grid thumbnail cache for a presentation (fire-and-forget).
 * Called after a publish, and — debounced, via
 * {@link scheduleDeckThumbnailWarm} — after a save that touched slide 1, so the
 * deck shows its raster on the next list load instead of making that load the
 * trigger. Best-effort: any failure just leaves the on-demand route to
 * regenerate later. Uses slide 1, matching what the thumbnail route serves.
 *
 * Honors the same gate as the save-path queue ({@link warmOnSaveEnabled}) so
 * *every* background warm — debounced or direct — is off under the test
 * runner: a warm launches the process-lifetime headless-Chrome singleton
 * (server/utils/puppeteer-browser.js), which outlives a test process and
 * hangs the suite wherever Chrome is installed.
 *
 * @param {import('../storage/scope.js').StorageScope} scope - The request's storage scope
 * @param {object} pres - Full presentation, post-save.
 * @returns {Promise<void>}
 */
export async function warmDeckThumbnail(scope, pres) {
  if (!warmOnSaveEnabled()) return;
  try {
    const slide = Array.isArray(pres?.slides) ? pres.slides[0] : null;
    if (!slide || typeof slide !== 'object') return;
    const theme = await loadThemeAssets(scope.repoRoot, pres?.theme);
    const slideTypes = await buildMergedSlideTypes(scope);
    await requestThumbnailGeneration(
      scope.repoRoot,
      pres,
      slide,
      theme,
      slideTypes,
    );
  } catch (err) {
    // Best-effort: the on-demand route regenerates on the next request, so a
    // failed warm costs a card its head start and nothing else. Still worth a
    // line — a warm that fails every time is a missing dependency, not noise.
    log.warn(
      `warm failed for ${pres?.id || 'unknown deck'}:`,
      err?.message || err,
    );
  }
}

/**
 * Queue a debounced thumbnail warm after a save, but only when the save
 * actually changed slide 1.
 *
 * Both halves are load-bearing. The signature check keeps the 90% case free —
 * most saves edit a slide the card never shows, and since PR #422 those don't
 * invalidate the raster either, so there is nothing to warm. The debounce
 * (see ./thumbnail-warm-queue.js) keeps the remaining case off the autosave
 * treadmill: a typing burst on slide 1 collapses into one render once the deck
 * goes quiet.
 *
 * Returns immediately; the render happens later, on no request's thread.
 *
 * @param {object} params
 * @param {import('../storage/scope.js').StorageScope} params.scope - The request's storage scope
 * @param {object} params.before - Presentation as it was before the save.
 * @param {object} params.after - Presentation as stored after the save.
 * @returns {boolean} whether a warm is now pending for this deck.
 */
export function scheduleDeckThumbnailWarm({ scope, before, after } = {}) {
  const id = after?.id;
  if (!id) return false;
  if (firstSlideSignature(before) === firstSlideSignature(after)) return false;
  return scheduleThumbnailWarm(String(id), () =>
    warmDeckThumbnail(scope, after),
  );
}
