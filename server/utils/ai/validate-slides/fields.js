/**
 * Field-key inspection.
 *
 * Derives the set of valid field keys per slide type and detects unknown
 * fields that the AI produced but the slide type doesn't support. Used both to
 * log content loss (for prompt improvement) and to report unknown fields.
 */

import { declaredContentKeys } from '../../../../shared/slide-types/declared-keys.js';
import { logValidation } from './logging.js';

/**
 * Check for unknown fields in slide content that the slide type doesn't support.
 * Logs warnings for debugging and prompt improvement.
 *
 * The valid keys are `declaredContentKeys()`, the one predicate strict
 * validation and the deck import read as well (B242), taken off the
 * definition the caller resolved in its own map, so an organization's type is
 * read as itself (B247).
 *
 * @param {Object|undefined} def - The slide type definition
 * @param {Object} content - The slide content object
 * @param {Object} context - Additional context for logging (`slideType`, …)
 */
export function checkForUnknownFields(def, content, context = {}) {
  if (!content || typeof content !== 'object') return;
  if (!def) {
    // Unknown slide type - can't validate fields
    return;
  }

  const validKeys = declaredContentKeys(def);
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
 * @param {Object|undefined} def - The slide type definition
 * @param {Object} content - The slide content object
 * @returns {Array<string>} Array of unknown field names
 */
export function getUnknownFields(def, content) {
  if (!content || typeof content !== 'object') return [];
  if (!def) return [];

  const validKeys = declaredContentKeys(def);
  return Object.keys(content).filter((key) => {
    if (validKeys.has(key)) return false;
    const value = content[key];
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && !value.trim()) return false;
    return true;
  });
}
