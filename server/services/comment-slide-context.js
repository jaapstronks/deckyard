/**
 * Slide-context enrichment for comment payloads (public API v1 + MCP).
 *
 * Machine clients reading comments need to know what a comment is about
 * without extra calls: which slide it's anchored to *now* (index, type,
 * derived title — or the fact that the slide was deleted), plus the stored
 * `slideSnapshot` of the slide as it was at create time (see migration 041;
 * null for comments that predate it, which the payload reports honestly).
 */

/**
 * Best display title for a slide, regardless of type.
 * Falls through: title → tagline → quote → label → value.
 */
function deriveSlideTitle(slide) {
  const c = slide?.content;
  if (!c) return '';
  return c.title || c.tagline || c.quote || c.label || c.value || '';
}

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
    })
  );
}

/**
 * Current-state context for the slide a comment is anchored to.
 * @param {Object} pres - The presentation (with slides[])
 * @param {string|null} slideId - The comment's slideId
 * @returns {Object|null} - null when the comment has no slide anchor;
 *   `{ deleted: true }` when the slide no longer exists.
 */
export function slideContextFor(pres, slideId) {
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
    title: deriveSlideTitle(slide),
  };
}

/**
 * Enrich a list of comments (and their nested replies) with `slide`
 * current-state context. `slideSnapshot` already rides along from storage.
 * Returns new objects; does not mutate the input.
 * @param {Array} comments
 * @param {Object} pres - The presentation the comments belong to
 * @returns {Array}
 */
export function enrichCommentsWithSlideContext(comments, pres) {
  if (!Array.isArray(comments)) return [];
  return comments.map((comment) => ({
    ...comment,
    slide: slideContextFor(pres, comment?.slideId),
    replies: Array.isArray(comment?.replies)
      ? enrichCommentsWithSlideContext(comment.replies, pres)
      : [],
  }));
}
