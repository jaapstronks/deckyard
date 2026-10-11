/**
 * Field-key inspection.
 *
 * Derives the set of valid field keys per slide type and detects unknown
 * fields that the AI produced but the slide type doesn't support. Used both to
 * log content loss (for prompt improvement) and to report unknown fields.
 */

import { SLIDE_TYPES } from '../../../../shared/slide-types/registry.js';
import { declaredContentKeys } from '../../../../shared/slide-types/declared-keys.js';
import { logValidation } from './logging.js';

/**
 * The keys a slide of this type may carry: `declaredContentKeys()`, the one
 * predicate strict validation and the deck import read as well. A list of its
 * own here named only `fields[]`, the a11y pair and the contrast keys, so it
 * logged an instance key such as a poll's `pollId` as content loss on a slide
 * strict accepts (B242).
 *
 * @param {string} slideType - The slide type name (e.g., 'content-slide')
 * @returns {ReadonlySet<string>}
 */
function getValidFieldKeys(slideType) {
  return declaredContentKeys(SLIDE_TYPES[slideType]);
}

/**
 * Check for unknown fields in slide content that the slide type doesn't support.
 * Logs warnings for debugging and prompt improvement.
 *
 * @param {string} slideType - The slide type name
 * @param {Object} content - The slide content object
 * @param {Object} context - Additional context for logging
 */
export function checkForUnknownFields(slideType, content, context = {}) {
  if (!content || typeof content !== 'object') return;
  if (!SLIDE_TYPES[slideType]) {
    // Unknown slide type - can't validate fields
    return;
  }

  const validKeys = getValidFieldKeys(slideType);
  const contentKeys = Object.keys(content);
  const unknownKeys = contentKeys.filter((key) => !validKeys.has(key));

  if (unknownKeys.length > 0) {
    // Check which unknown fields have meaningful content (not empty/null)
    const unknownWithContent = unknownKeys.filter((key) => {
      const value = content[key];
      if (value === null || value === undefined) return false;
      if (typeof value === 'string' && !value.trim()) return false;
      return true;
    });

    if (unknownWithContent.length > 0) {
      logValidation('unknown-fields', {
        slideType,
        unknownFields: unknownWithContent,
        // Include sample values for debugging (truncated)
        sampleValues: Object.fromEntries(
          unknownWithContent.map((key) => {
            const val = content[key];
            const str = typeof val === 'string' ? val : JSON.stringify(val);
            return [key, str.length > 100 ? str.slice(0, 100) + '...' : str];
          }),
        ),
        validFields: Array.from(validKeys).slice(0, 10), // Show some valid options
        ...context,
      });
    }
  }
}

/**
 * Get unknown fields from slide content (fields that won't be rendered)
 * Useful for debugging and prompt improvement
 *
 * @param {string} slideType - The slide type name
 * @param {Object} content - The slide content object
 * @returns {Array<string>} Array of unknown field names
 */
export function getUnknownFields(slideType, content) {
  if (!content || typeof content !== 'object') return [];
  if (!SLIDE_TYPES[slideType]) return [];

  const validKeys = getValidFieldKeys(slideType);
  return Object.keys(content).filter((key) => {
    if (validKeys.has(key)) return false;
    const value = content[key];
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && !value.trim()) return false;
    return true;
  });
}
