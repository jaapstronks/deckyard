/**
 * Shared interaction helpers for poll, likert, and feedback slides
 * Consolidates duplicate functions from live-sessions.js, follow/interactions.js, and follow/helpers.js
 */

import {
  liveInteractionOptions,
  nonEmpty,
} from '../../shared/slide-types/helpers.js';
import { liveInteractionKind } from '../../shared/slide-types/runtime.js';

// `isInteractiveSlideType()` used to live here as a hard-coded list of four
// type names — one of nine copies. It is now `isLiveSlideType()` in
// shared/slide-types/runtime.js, which asks the type instead of recognising it.

/**
 * Get content object from slide safely
 * @param {Object} slide - Slide object
 * @returns {Object} Content object or empty object
 */
function getSlideContent(slide) {
  return slide?.content && typeof slide.content === 'object'
    ? slide.content
    : {};
}

/**
 * The authored options of a live slide, in stored order.
 *
 * One function for poll and likert alike: since schema v9 both carry the same
 * `options[]` array (the live content contract in
 * shared/slide-types/runtime.js), so the two hand-written readers that walked
 * `option1..option4` and `option1..option10` are one call to the shared reader.
 * Positional and unfiltered — the index is the option's identity, and it is the
 * `option_index` a vote is stored under.
 *
 * @param {Object} slide - a poll or likert slide object
 * @returns {string[]} Array of option strings
 */
export function optionsFromSlide(slide) {
  return liveInteractionOptions(getSlideContent(slide));
}

/**
 * Get the question of a live slide
 * @param {Object} slide - a live slide object
 * @returns {string} Question text or empty string
 */
export function questionFromSlide(slide) {
  const c = getSlideContent(slide);
  return nonEmpty(c.question);
}

/**
 * Get likert slider option count (always 10 for slider)
 * @param {Object} _slide - Likert slider slide object (unused)
 * @returns {number} Always returns 10
 */
function likertSliderOptionCountFromSlide(_slide) {
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
  if (kind === 'likert' && slideType === 'likert-slider-slide')
    return likertSliderOptionCountFromSlide(slide);
  if (kind === 'likert' || kind === 'poll')
    return optionsFromSlide(slide).length;
  return 0;
}
