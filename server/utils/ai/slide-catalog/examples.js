/**
 * AI slide-type examples: the filled-in content the generation prompts show
 * per type, so a model copies a worked field shape instead of guessing one
 * from the schema.
 *
 * The examples are no longer written here, and no longer filed into category
 * modules (basic / data / card / diagram / text-blocks — a filing decision
 * nobody could derive from the type, which let `timeline-slide` sit in two of
 * them with one silently dead). Every type that has examples declares them as
 * `aiExamples` in its own `shared/slide-types/types/<name>/ai.js`, and
 * `./type-ai.js` — generated over those directories — is the import list.
 *
 * **Sparse by design.** A type without examples simply has none: the prompt
 * describes its schema without worked content, and the `ai-examples` companion
 * is optional in tests/helpers/slide-type-companions.js. Do not invent
 * examples to fill the matrix.
 *
 * This module keeps the custom-type overlay: forks can ship examples with a
 * custom type (`custom/slide-types/*.js`, loaded by `custom-loader.js`), which
 * merge over the core map at server startup — same shape as
 * `mergeCustomAiCatalog` in `definitions.js`.
 */

import { SLIDE_TYPE_AI_EXAMPLES } from './type-ai.js';

/**
 * All slide type examples combined (core + custom)
 * @type {Record<string, Array<Object>>}
 */
export let SLIDE_TYPE_EXAMPLES = { ...SLIDE_TYPE_AI_EXAMPLES };

/**
 * Merge custom examples into the catalog
 * Called during server startup after custom types are loaded
 * @param {Object} customExamples - Map of type-name -> examples array
 */
export function mergeCustomExamples(customExamples) {
  if (customExamples && typeof customExamples === 'object') {
    SLIDE_TYPE_EXAMPLES = {
      ...SLIDE_TYPE_AI_EXAMPLES,
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
