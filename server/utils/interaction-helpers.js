/**
 * Shared interaction helpers for poll, likert, and feedback slides
 * Consolidates duplicate functions from live-sessions.js, follow/interactions.js, and follow/helpers.js
 */

import {
  liveInteractionOptions,
  nonEmpty,
} from '../../shared/slide-types/helpers.js';
import {
  liveInteractionKind,
  liveScale,
} from '../../shared/slide-types/runtime.js';

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
 * The number of stops on a declared scale: `min..max` inclusive.
 * @param {{min: number, max: number}} scale
 * @returns {number}
 */
function scaleStopCount(scale) {
  return scale.max - scale.min + 1;
}

/**
 * Interaction data for a likert type that declares a `scale` (the slider): its
 * options are the scale's stops, `min..max`, read from the declaration
 * (`liveScale()`), so option `i` is the score `min + i`.
 *
 * @param {Object} slide - a slide of a type that declares a scale
 * @param {{min: number, max: number}} scale - the type's `liveScale()`
 * @returns {Object} Interaction data with question, options, minLabel, maxLabel
 */
export function scaleInteractionFromSlide(slide, scale) {
  const c = getSlideContent(slide);
  const question = nonEmpty(c.question);
  const minLabel = nonEmpty(c.minLabel);
  const maxLabel = nonEmpty(c.maxLabel);
  const options = Array.from({ length: scaleStopCount(scale) }, (_t, i) =>
    String(scale.min + i),
  );
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
 * Dispatches on declarations, not on the type name: the interaction kind says
 * whether the slide collects a choice at all, and a likert type that declares
 * a `scale` (the slider) answers with the scale's stops instead of authored
 * options — same protocol kind, the stops come from the type.
 *
 * @param {string} slideType - The slide type
 * @param {Object} slide - The slide object
 * @returns {number} Number of options for the slide type
 */
export function getOptionCountForSlide(slideType, slide) {
  if (!slide) return 0;
  const kind = liveInteractionKind(slideType);
  const scale = liveScale(slideType);
  if (scale) return scaleStopCount(scale);
  if (kind === 'likert' || kind === 'poll')
    return optionsFromSlide(slide).length;
  return 0;
}
