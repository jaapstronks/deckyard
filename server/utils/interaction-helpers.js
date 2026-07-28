/**
 * Shared interaction helpers for poll, likert, and feedback slides
 * Consolidates duplicate functions from present-sessions.js, follow/interactions.js, and follow/helpers.js
 */

import { nonEmpty } from '../../shared/slide-types/helpers.js';
import { liveInteractionKind } from '../../shared/slide-types/runtime.js';

// Re-export for backwards compatibility
export { nonEmpty };

// `isInteractiveSlideType()` used to live here as a hard-coded list of four
// type names — one of nine copies. It is now `isLiveSlideType()` in
// shared/slide-types/runtime.js, which asks the type instead of recognising it.

/**
 * Get content object from slide safely
 * @param {Object} slide - Slide object
 * @returns {Object} Content object or empty object
 */
function getSlideContent(slide) {
  return slide?.content && typeof slide.content === 'object' ? slide.content : {};
}

/**
 * Get poll options from a poll slide
 * @param {Object} slide - Poll slide object
 * @returns {string[]} Array of option strings (non-empty only)
 */
export function pollOptionsFromSlide(slide) {
  const c = getSlideContent(slide);
  return [
    nonEmpty(c.option1),
    nonEmpty(c.option2),
    nonEmpty(c.option3),
    nonEmpty(c.option4),
  ].filter(Boolean);
}

/**
 * Get poll option count from a poll slide
 * @param {Object} slide - Poll slide object
 * @returns {number} Number of non-empty options
 */
export function pollOptionCountFromSlide(slide) {
  return pollOptionsFromSlide(slide).length;
}

/**
 * Get poll question from a poll slide
 * @param {Object} slide - Poll slide object
 * @returns {string} Question text or empty string
 */
export function pollQuestionFromSlide(slide) {
  const c = getSlideContent(slide);
  return nonEmpty(c.question);
}

/**
 * Get likert options from a likert slide (up to 10 options)
 * @param {Object} slide - Likert slide object
 * @returns {string[]} Array of option strings (non-empty only)
 */
export function likertOptionsFromSlide(slide) {
  const c = getSlideContent(slide);
  const out = [];
  for (let i = 1; i <= 10; i += 1) {
    const v = nonEmpty(c[`option${i}`]);
    if (v) out.push(v);
  }
  return out;
}

/**
 * Get likert option count from a likert slide
 * @param {Object} slide - Likert slide object
 * @returns {number} Number of non-empty options
 */
export function likertOptionCountFromSlide(slide) {
  return likertOptionsFromSlide(slide).length;
}

/**
 * Get likert question from a likert slide
 * @param {Object} slide - Likert slide object
 * @returns {string} Question text or empty string
 */
export function likertQuestionFromSlide(slide) {
  const c = getSlideContent(slide);
  return nonEmpty(c.question);
}

/**
 * Get likert slider option count (always 10 for slider)
 * @param {Object} _slide - Likert slider slide object (unused)
 * @returns {number} Always returns 10
 */
export function likertSliderOptionCountFromSlide(_slide) {
  return 10;
}

/**
 * Get slider-10 interaction data from a likert-slider slide
 * @param {Object} slide - Likert slider slide object
 * @returns {Object} Interaction data with question, options, minLabel, maxLabel
 */
export function slider10InteractionFromSlide(slide) {
  const c = getSlideContent(slide);
  const question = nonEmpty(c.question);
  const minLabel = nonEmpty(c.minLabel);
  const maxLabel = nonEmpty(c.maxLabel);
  const options = Array.from({ length: 10 }, (_t, i) => String(i + 1));
  return { question, options, minLabel, maxLabel };
}

/**
 * Get feedback interaction data from a feedback slide
 * @param {Object} slide - Feedback slide object
 * @returns {Object} Interaction data with question, placeholder, maxLength
 */
export function feedbackInteractionFromSlide(slide) {
  const c = getSlideContent(slide);
  return {
    question: nonEmpty(c.question),
    placeholder: nonEmpty(c.placeholder),
    maxLength: 4000,
  };
}

/**
 * Find a slide by ID in a presentation
 * @param {Object} pres - Presentation object
 * @param {string} slideId - Slide ID to find
 * @returns {Object|null} Slide object or null if not found
 */
export function findSlideById(pres, slideId) {
  const sid = String(slideId || '').trim();
  if (!sid) return null;
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  return slides.find((s) => String(s?.id || '') === sid) || null;
}

/**
 * Get option count for any live slide type
 *
 * Dispatches on the declared interaction kind, not on the type name. The one
 * remaining name check is `likert-slider-slide`'s: the slider asks for a point
 * on the same scale a likert slide does (same protocol kind), but its ten stops
 * are fixed by the widget rather than authored as options.
 *
 * @param {string} slideType - The slide type
 * @param {Object} slide - The slide object
 * @returns {number} Number of options for the slide type
 */
export function getOptionCountForSlide(slideType, slide) {
  if (!slide) return 0;
  const kind = liveInteractionKind(slideType);
  if (kind === 'likert') {
    return slideType === 'likert-slider-slide'
      ? likertSliderOptionCountFromSlide(slide)
      : likertOptionCountFromSlide(slide);
  }
  if (kind === 'poll') return pollOptionCountFromSlide(slide);
  return 0;
}