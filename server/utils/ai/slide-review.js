/**
 * The one review shape every AI prompt route answers per slide (B590): why
 * this type fits, up to three other types that could, and optionally a
 * suggestion to put a picture behind the slide.
 *
 * Refine (the wizard and the imports), append ("add slides", internal and MCP)
 * and refine-section ("adjust section") all ask the model for the same three
 * keys and read them through {@link parseSlideReview}; the stored form is
 * written by {@link attachSlideReview} alone. The stored keys are the
 * `_aiReasoning` / `_aiAlternatives` / `_aiSuggestAfter` members of
 * `AI_REVIEW_KEYS` (`server/utils/public-output.js`), so every reader
 * projection that strips the review notes strips these as well.
 *
 * @module server/utils/ai/slide-review
 */

import { resolveSlideTypeName } from '../../../shared/slide-types/registry.js';

/** Most alternative types a slide offers in the review. */
export const MAX_REVIEW_ALTERNATIVES = 3;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @typedef {Object} SlideReview
 * @property {string} why - why this type fits, for the author
 * @property {Array<{type: string, reason: string}>} alternatives - at most
 *   {@link MAX_REVIEW_ALTERNATIVES}, each an offered type other than the
 *   slide's own, no type twice
 * @property {{reason: string}|null} imageSuggestionAfter - a picture would
 *   help right behind this slide
 */

/**
 * Read the review keys of one model slide. The model's raw answer is the
 * input; the slide type is the one the slide ended up with, so an alternative
 * that names it is dropped.
 *
 * @param {Object} raw - one slide as the model returned it
 * @param {Object} options
 * @param {string} options.type - the slide's final type
 * @param {(ref: string) => string} options.offeredType - the registry key a
 *   type reference names when that type may be offered, `''` otherwise
 * @returns {SlideReview}
 */
export function parseSlideReview(raw, { type, offeredType }) {
  const seen = new Set([type]);
  const alternatives = [];
  for (const alt of Array.isArray(raw?.alternatives) ? raw.alternatives : []) {
    const altType = offeredType(text(alt?.type));
    if (!altType || seen.has(altType)) continue;
    seen.add(altType);
    alternatives.push({ type: altType, reason: text(alt?.reason) });
    if (alternatives.length === MAX_REVIEW_ALTERNATIVES) break;
  }
  const suggestionReason = text(raw?.imageSuggestionAfter?.reason);
  return {
    why: text(raw?.why),
    alternatives,
    imageSuggestionAfter: suggestionReason
      ? { reason: suggestionReason }
      : null,
  };
}

/**
 * Write a parsed review onto a stored slide. Empty parts leave their key off.
 *
 * @param {Object} slide - the composed slide, mutated
 * @param {SlideReview|null|undefined} review
 * @returns {Object} the slide
 */
export function attachSlideReview(slide, review) {
  if (!slide || typeof slide !== 'object' || !review) return slide;
  if (review.why) slide._aiReasoning = review.why;
  if (review.alternatives?.length) slide._aiAlternatives = review.alternatives;
  if (review.imageSuggestionAfter)
    slide._aiSuggestAfter = review.imageSuggestionAfter;
  return slide;
}

/**
 * The `offeredType` answer for {@link parseSlideReview}: a reference resolves
 * through the registry (a reverse-DNS id folds to its key) and must not be a
 * type the organization switched off.
 *
 * @param {Record<string, Object>} slideTypes - the merged registry
 * @param {string[]} [disabledSlideTypes]
 * @returns {(ref: string) => string}
 */
export function offeredTypeResolver(slideTypes, disabledSlideTypes = []) {
  const disabled = new Set(disabledSlideTypes);
  return (ref) => {
    const key = resolveSlideTypeName(ref, slideTypes || {});
    return key && !disabled.has(key) ? key : '';
  };
}

/**
 * Parse and attach the reviews of a model batch onto its composed slides.
 * Both arrays map 1:1 by index (composition keeps the order and count).
 *
 * @param {Object[]} slides - the composed slides, mutated
 * @param {Object[]} rawSlides - the slides as the model returned them
 * @param {Object} options
 * @param {Record<string, Object>} options.slideTypes - the merged registry
 * @param {string[]} [options.disabledSlideTypes] - types the organization
 *   switched off
 * @returns {Object[]} the slides
 */
export function attachBatchReviews(
  slides,
  rawSlides,
  { slideTypes, disabledSlideTypes = [] },
) {
  const offeredType = offeredTypeResolver(slideTypes, disabledSlideTypes);
  slides.forEach((slide, i) => {
    if (!slide || typeof slide !== 'object') return;
    attachSlideReview(
      slide,
      parseSlideReview(rawSlides?.[i], { type: slide.type, offeredType }),
    );
  });
  return slides;
}
