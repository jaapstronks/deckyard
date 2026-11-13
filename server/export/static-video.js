/**
 * What a static export (PDF, PNG) hands the video slide so it renders a still
 * instead of a player: the poster, inlined, and for the PDF the address where
 * the video can be watched. The slide type itself draws the frame
 * (`ctx.staticVideo`, shared/slide-types/types/video-slide/static-frame.js), so
 * the page keeps the slide's ground, title and frame instead of being a page of
 * its own. See docs/reference/video-slide-pdf-export.md.
 */

import { resolveVideoThumbnailDataUrl } from './video-thumbnail.js';
import { resolveVideoWatchUrl } from './video-watch-url.js';

/**
 * @param {object} slide - Any slide; only a video slide gets a context.
 * @param {object} [opts]
 * @param {Function} [opts.transform] - Image-bytes transform for the poster.
 * @param {Map<string, Promise<string>>} [opts.cache] - Per-run embed cache.
 * @param {{ pres: object, baseUrl: string, slideIndex: number }} [opts.watch] -
 *   Resolve a watch URL and caption the frame with it (the PDF). Without it the
 *   frame carries no caption (the PNG, which cannot be clicked).
 * @returns {Promise<import('../../shared/slide-types/types/video-slide/static-frame.js').StaticVideo|null>}
 */
export async function staticVideoContext(
  slide,
  { transform = null, cache = null, watch = null } = {},
) {
  if (slide?.type !== 'video-slide') return null;
  // Fetched and inlined here rather than left as a remote <img src> for the
  // generic embed pass: Bunny's CDN 403s a request without a referer, so that
  // pass would silently drop it. See video-thumbnail.js.
  const still =
    (await resolveVideoThumbnailDataUrl(slide.content, { transform, cache })) ||
    '';
  if (!watch) return { still };
  const { url } = resolveVideoWatchUrl(slide, watch.pres, {
    baseUrl: watch.baseUrl,
    slideIndex: watch.slideIndex,
  });
  return { still, caption: true, watchUrl: url || '' };
}
