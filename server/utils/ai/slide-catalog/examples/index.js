/**
 * AI Slide Type Examples Index
 * Aggregates all slide type examples from categorized files
 */

import { BASIC_SLIDE_EXAMPLES } from './basic-slides.js';
import { DATA_SLIDE_EXAMPLES } from './data-slides.js';
import { CARD_SLIDE_EXAMPLES } from './card-slides.js';
import { DIAGRAM_SLIDE_EXAMPLES } from './diagram-slides.js';
import { TEXT_BLOCKS_SLIDE_EXAMPLES } from './text-blocks-slide.js';

/**
 * Core slide type examples
 */
const CORE_SLIDE_TYPE_EXAMPLES = {
  ...BASIC_SLIDE_EXAMPLES,
  ...DATA_SLIDE_EXAMPLES,
  ...CARD_SLIDE_EXAMPLES,
  ...DIAGRAM_SLIDE_EXAMPLES,
  ...TEXT_BLOCKS_SLIDE_EXAMPLES,
};

/**
 * All slide type examples combined (core + custom)
 */
export let SLIDE_TYPE_EXAMPLES = { ...CORE_SLIDE_TYPE_EXAMPLES };

/**
 * Merge custom examples into the catalog
 * Called during server startup after custom types are loaded
 * @param {Object} customExamples - Map of type-name -> examples array
 */
export function mergeCustomExamples(customExamples) {
  if (customExamples && typeof customExamples === 'object') {
    SLIDE_TYPE_EXAMPLES = {
      ...CORE_SLIDE_TYPE_EXAMPLES,
      ...customExamples,
    };
  }
}

/**
 * Get all example variations for a slide type
 * @param {string} type - Slide type name
 * @returns {Array|null} Array of examples or null if not found
 */
export function getSlideTypeExamples(type) {
  return SLIDE_TYPE_EXAMPLES[type] || null;
}

/**
 * Get the first example for a slide type (backward compatibility)
 * @param {string} type - Slide type name
 * @returns {Object|null} First example or null if not found
 */
export function getSlideTypeExample(type) {
  const examples = getSlideTypeExamples(type);
  if (!examples) return null;
  return examples[0];
}

// Re-export category-specific examples for targeted imports
export {
  BASIC_SLIDE_EXAMPLES,
  DATA_SLIDE_EXAMPLES,
  CARD_SLIDE_EXAMPLES,
  DIAGRAM_SLIDE_EXAMPLES,
  TEXT_BLOCKS_SLIDE_EXAMPLES,
};