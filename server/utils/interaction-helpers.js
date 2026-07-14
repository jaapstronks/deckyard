/**
 * Shared interaction helpers for poll, likert, and feedback slides
 * Consolidates duplicate functions from present-sessions.js, follow/interactions.js, and follow/helpers.js
 */

import { nonEmpty } from '../../shared/slide-types/helpers.js';

// Re-export for backwards compatibility
export { nonEmpty };

/**
 * Check if a slide type is interactive (requires interaction state)
 * @param {string} slideType - The slide type
 * @returns {boolean} True if the slide type supports interactions
 */
export function isInteractiveSlideType(slideType) {
  return (
    slideType === 'poll-slide' ||
    slideType === 'likert-slide' ||
    slideType === 'likert-slider-slide' ||
    slideType === 'feedback-slide'
  );
}

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
 * Get option count for any interactive slide type
 * @param {string} slideType - The slide type
 * @param {Object} slide - The slide object
 * @returns {number} Number of options for the slide type
 */
export function getOptionCountForSlide(slideType, slide) {
  if (slideType === 'likert-slide') {
    return slide ? likertOptionCountFromSlide(slide) : 0;
  }
  if (slideType === 'likert-slider-slide') {
    return slide ? likertSliderOptionCountFromSlide(slide) : 0;
  }
  if (slideType === 'poll-slide') {
    return slide ? pollOptionCountFromSlide(slide) : 0;
  }
  return 0;
}