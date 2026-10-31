// Helpers for outputs that must not include "live-only" slides, or anything
// else a reader without edit rights has no business receiving.

import { pinSlideJumps } from '../../shared/slide-types.js';
import {
  filterSlidesForContext,
  isSlideVisibleIn,
} from '../../shared/slide-visibility.js';
import { isLiveOnlySlideType } from '../../shared/slide-types/live-session.js';
import { isFeatureEnabled } from '../config/flags-snapshot.js';

/**
 * Drop the slides whose type declares `liveOnly: true` — content that only
 * means something while a session is running (the follow-along invite).
 * A declaration on the type, not a list of names here, so a fork type can say
 * the same thing.
 * @param {Object} pres - Presentation object
 * @returns {Object} the presentation, unchanged when nothing was live-only
 */
export function stripLiveOnlySlidesFromPresentation(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  const slides = Array.isArray(pres.slides) ? pres.slides : [];
  const filtered = slides.filter(
    (s) => !(s && typeof s === 'object' && isLiveOnlySlideType(s.type)),
  );
  // Avoid cloning big objects unless we actually changed something.
  if (filtered.length === slides.length) return pres;
  return { ...pres, slides: filtered };
}

/**
 * The first slide an output that outlives the session can show: what the
 * preview image of a published or shared deck is rendered from. The same
 * `liveOnly` declaration as the strip above, asked once instead of by three
 * callers in their own words (B413).
 * @param {Object} pres - Presentation object
 * @param {{channel: 'share'|'published', slideTypes?: Object}} options
 * @returns {Object|null} the first permitted slide, or null for an empty audience
 */
export function firstPublicSlide(pres, { channel, slideTypes } = {}) {
  if (!['share', 'published'].includes(channel)) {
    throw new TypeError('A public preview requires an explicit channel');
  }
  const projected = projectPresentationForAudience(pres, {
    audience: 'reader',
    channel,
    slideTypes,
  });
  return (
    projected?.slides?.find(
      (slide) => slide && !isLiveOnlySlideType(slide?.type),
    ) || null
  );
}

/**
 * Filter presentation for export context (PDF, PNG, PPTX, print, standalone
 * HTML, the handoff ZIP, the reader export): drops live-only slides, slides
 * with `hideInExport` and incomplete slides (B590) from every slide list the
 * deck carries, its language versions included (B698). Positional jumps are
 * pinned against each original list first, so `#N` keeps naming the slide it
 * named in the stored order.
 * @param {Object} pres - Presentation object
 * @param {Object} [options]
 * @param {Object} [options.slideTypes] - The deck organization's registry
 * @returns {Object} Filtered presentation, unchanged when nothing was dropped
 */
export function filterForExport(pres, { slideTypes } = {}) {
  slideTypes = slideTypes || undefined;
  const exported = (slide) =>
    !!slide &&
    typeof slide === 'object' &&
    !isLiveOnlySlideType(slide.type, slideTypes) &&
    isSlideVisibleIn(slide, 'export', { slideTypes });
  return mapDeckSlideLists(pres, (slides) => {
    if (slides.every(exported)) return slides;
    return pinSlideJumps(slides, slideTypes).filter(exported);
  });
}

/**
 * Filter presentation for published/public context (embed, /p/ pages).
 * Removes live-only slides, author notes/AI fields and hideInPublished
 * slides from every carried language list, pinning links before filtering.
 * @param {Object} pres - Presentation object
 * @returns {Object} Filtered presentation
 */
export function filterForPublished(pres, { slideTypes } = {}) {
  return projectPresentationForAudience(pres, {
    audience: 'reader',
    channel: 'published',
    slideTypes,
  });
}

/**
 * Apply `fn` to every slide list a deck carries: `slides` and the `slides` of
 * each language version in `i18n.versions`. A reader-facing filter that only
 * touched `slides` would leave the same slides readable in every other
 * version of the response (B698).
 * @param {Object} pres - Presentation object
 * @param {(slides: Object[]) => Object[]} fn - returns the list to serve;
 *   the same array when nothing changed
 * @returns {Object} the presentation, unchanged when `fn` changed no list
 */
export function mapDeckSlideLists(pres, fn) {
  if (!pres || typeof pres !== 'object') return pres;
  let changed = false;
  const apply = (owner) => {
    if (!owner || typeof owner !== 'object' || !Array.isArray(owner.slides)) {
      return owner;
    }
    const slides = fn(owner.slides);
    if (slides === owner.slides) return owner;
    changed = true;
    return { ...owner, slides };
  };
  const next = apply(pres);
  const versions = pres.i18n?.versions;
  if (!versions || typeof versions !== 'object') return changed ? next : pres;
  const nextVersions = Object.fromEntries(
    Object.entries(versions).map(([lang, version]) => [lang, apply(version)]),
  );
  if (!changed) return pres;
  return { ...next, i18n: { ...pres.i18n, versions: nextVersions } };
}

/**
 * The per-slide review notes the AI generation writes for the author: the
 * reasoning the editor's slide notes show, the alternative types the review
 * grid offers, the suggestion to put a picture behind the slide, the
 * validation warnings. They can quote the source the deck was made from, so
 * they are the author's working material, not deck content.
 */
export const AI_REVIEW_KEYS = Object.freeze([
  '_aiReasoning',
  '_aiAlternatives',
  '_aiSuggestAfter',
  '_aiWarnings',
  '_aiReview',
]);

const hasAiReviewMeta = (slide) =>
  !!slide &&
  typeof slide === 'object' &&
  AI_REVIEW_KEYS.some((key) => key in slide);

/**
 * Drop the {@link AI_REVIEW_KEYS} from every slide of every language version:
 * whoever may only look at a deck gets what the slides show, not the notes
 * the generation left for the author (B767). The surfaces that serve a reader
 * without edit rights call this through their filter (view-only, share
 * viewer, published) or directly (follow-along, public v1).
 * @param {Object} pres - Presentation object
 * @returns {Object} the presentation, unchanged when no slide carried a note
 */
export function stripAiReviewMeta(pres) {
  return mapDeckSlideLists(pres, (slides) => {
    if (!slides.some(hasAiReviewMeta)) return slides;
    return slides.map((slide) => {
      if (!hasAiReviewMeta(slide)) return slide;
      const out = { ...slide };
      for (const key of AI_REVIEW_KEYS) delete out[key];
      return out;
    });
  });
}

/**
 * The deck an anonymous share viewer gets (`/s/:token`): the view-only filter
 * with drafts badged, and with the live cluster off no live-only slide either.
 * The viewer has no feature snapshot, so the server's answer is what it
 * serves (D260, as `tracking` carries the analytics answer): an invite into a
 * session nothing can start does not leave. A signed-in reader keeps the
 * slide in its static form and asks its snapshot.
 * @param {Object} pres - Presentation object
 * @param {Object} [options]
 * @param {Object} [options.slideTypes] - The deck organization's registry
 * @returns {Object} Filtered presentation
 */
export function filterForShareViewer(pres, { slideTypes } = {}) {
  return projectPresentationForAudience(pres, {
    audience: 'reader',
    channel: 'share',
    slideTypes,
    liveEnabled: isFeatureEnabled('live'),
  });
}

/**
 * Project a read response without changing storage or author loaders. Pin
 * positional links against each original language list before removing slides.
 * Audience is a server authorization decision; channel keeps share's live
 * feature policy separate from collaborator visibility.
 * @param {Object} pres
 * @param {Object} options
 * @param {'author'|'reader'} options.audience
 * @param {'viewer'|'share'|'follow'|'published'} options.channel
 * @param {Object} [options.slideTypes] - The deck organization's type registry
 * @param {boolean} [options.liveEnabled=true]
 * @returns {Object}
 */
export function projectPresentationForAudience(
  pres,
  { audience, channel, slideTypes, liveEnabled = true },
) {
  if (!['author', 'reader'].includes(audience)) {
    throw new TypeError('A read projection requires an explicit audience');
  }
  if (!['viewer', 'share', 'follow', 'published'].includes(channel)) {
    throw new TypeError('Unknown read projection channel');
  }
  if (audience === 'author') return pres;
  return mapDeckSlideLists(pres, (slides) => {
    const pinned = pinSlideJumps(
      slides.filter((slide) => slide && typeof slide === 'object'),
      slideTypes,
    );
    const visible =
      channel === 'published'
        ? filterSlidesForContext(pinned, 'published', { slideTypes })
        : channel === 'follow'
          ? pinned.filter(
              (slide) =>
                isSlideVisibleIn(slide, 'viewer', {
                  userPermission: 'read',
                  slideTypes,
                }) && isSlideVisibleIn(slide, 'presentation', { slideTypes }),
            )
          : filterSlidesForContext(pinned, 'viewer', {
              userPermission: 'read',
              markDrafts: true,
              slideTypes,
            });
    return visible
      .filter(
        (slide) =>
          (channel !== 'published' && (channel !== 'share' || liveEnabled)) ||
          !isLiveOnlySlideType(slide?.type),
      )
      .map((slide) => {
        const out = { ...slide };
        for (const key of ['notes', ...AI_REVIEW_KEYS]) delete out[key];
        return out;
      });
  });
}
