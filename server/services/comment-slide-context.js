/**
 * Slide-context enrichment for comment payloads (public API v1 + MCP).
 *
 * Machine clients reading comments need to know what a comment is about
 * without extra calls: which slide it's anchored to *now* (index, type,
 * derived title — or the fact that the slide was deleted), plus the stored
 * `slideSnapshot` of the slide as it was at create time (see migration 041;
 * null for comments that predate it, which the payload reports honestly).
 */

import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { getSlideType } from '../../shared/slide-types/registry.js';
import { slideTitle } from '../../shared/slide-types/semantic-projection.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';

/**
 * Snapshot of a slide for storage on a comment row: just the affected
 * slide (id, type, content), not the whole deck, to keep rows small.
 * @param {Object|null} slide
 * @returns {Object|null}
 */
export function buildSlideSnapshot(slide) {
  if (!slide || typeof slide !== 'object') return null;
  return JSON.parse(
    JSON.stringify({
      id: slide.id ?? null,
      type: slide.type ?? null,
      content: slide.content ?? {},
    }),
  );
}

/**
 * Current-state context for the slide a comment is anchored to.
 * @param {Object} pres - The presentation (with slides[])
 * @param {string|null} slideId - The comment's slideId
 * @param {Object} [options]
 * @param {Object} [options.slideTypes] - The org's merged registry
 *   (`buildMergedSlideTypes`), so an org-owned type yields its own heading
 * @returns {Object|null} - null when the comment has no slide anchor;
 *   `{ deleted: true }` when the slide no longer exists.
 */
export function slideContextFor(
  pres,
  slideId,
  { slideTypes = SLIDE_TYPES } = {},
) {
  if (!slideId) return null;
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const index = slides.findIndex((s) => s?.id === slideId);
  if (index === -1) return { deleted: true };
  const slide = slides[index];
  return {
    deleted: false,
    index,
    number: index + 1,
    type: slide?.type ?? null,
    title: slideTitle(slide, getSlideType(slide?.type, slideTypes), {
      lang: resolveDocLangFromPresentation(pres),
    }),
  };
}

/**
 * Enrich a list of comments (and their nested replies) with `slide`
 * current-state context. `slideSnapshot` already rides along from storage.
 * Returns new objects; does not mutate the input.
 * @param {Array} comments
 * @param {Object} pres - The presentation the comments belong to
 * @param {Object} [options]
 * @param {Object} [options.slideTypes] - The org's merged registry
 * @returns {Array}
 */
export function enrichCommentsWithSlideContext(comments, pres, options = {}) {
  if (!Array.isArray(comments)) return [];
  return comments.map((comment) => ({
    ...comment,
    slide: slideContextFor(pres, comment?.slideId, options),
    replies: Array.isArray(comment?.replies)
      ? enrichCommentsWithSlideContext(comment.replies, pres, options)
      : [],
  }));
}
