/**
 * Lightweight validation checks.
 *
 * Standalone predicates used to guide generation decisions: whether a slide
 * type is appropriate for given content, and whether a deck is over its slide
 * budget.
 */

import { SLIDE_ITEM_REQUIREMENTS, NON_CONTENT_SLIDE_TYPES } from './constants.js';
import { logValidation } from './logging.js';

/**
 * Pre-check if a slide type is appropriate given the content
 * Used to guide Phase 2 decisions
 *
 * @param {string} type - Proposed slide type
 * @param {Object} content - Proposed content
 * @returns {boolean} True if valid
 */
export function isSlideTypeValid(type, content) {
  const req = SLIDE_ITEM_REQUIREMENTS[type];
  if (!req) return true;

  const arr = content?.[req.field];
  if (!Array.isArray(arr)) return false;

  return arr.length >= req.min;
}

/**
 * Validate slide count against target and log warnings
 *
 * @param {Array} slides - Array of slides (refined or final deck slides)
 * @param {number} targetSlides - Target number of content slides
 * @returns {{ contentSlides: number, totalSlides: number, overBudget: boolean, percentage: number }}
 */
export function validateSlideCount(slides, targetSlides) {
  if (!Array.isArray(slides) || !targetSlides || targetSlides <= 0) {
    return { contentSlides: 0, totalSlides: 0, overBudget: false, percentage: 0 };
  }

  const contentSlides = slides.filter(s => {
    const type = s?.type || '';
    return !NON_CONTENT_SLIDE_TYPES.has(type);
  }).length;

  const totalSlides = slides.length;
  const overBudget = contentSlides > targetSlides * 1.5;
  const percentage = Math.round((contentSlides / targetSlides) * 100);

  if (overBudget) {
    logValidation('warn-over-budget', {
      contentSlides,
      targetSlides,
      percentage,
      threshold: '150%',
      totalSlides,
      message: `Generated ${contentSlides} content slides, target was ${targetSlides} (${percentage}% of target)`,
    });
  } else {
    // Info-level log for monitoring
    console.log(`[ValidateSlide] Slide budget: ${contentSlides}/${targetSlides} content slides (${percentage}%)`);
  }

  return { contentSlides, totalSlides, overBudget, percentage };
}
