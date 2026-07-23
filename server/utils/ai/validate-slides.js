/**
 * Slide Validation and Fixing
 *
 * Ensures AI-generated slides meet the minimum requirements for each slide type.
 * Fixes common issues like too few items and text exceeding max lengths.
 *
 * Includes Zod schema validation for defense-in-depth type checking.
 * Logs unknown fields that AI generates but the slide type doesn't support.
 *
 * Facade that preserves the historical import surface. The implementation is
 * split by concern under `validate-slides/`:
 * - `logging.js`: in-memory + disk validation event log.
 * - `constants.js`: item requirements + max-length tables shared by both validators.
 * - `fields.js`: valid-field-key derivation + unknown-field detection.
 * - `truncate.js` / `fixers.js`: text truncation + per-type content repairs.
 * - `fix.js`: the non-throwing fix pipeline (+ applied-fixes diff).
 * - `strict.js`: the throwing raw-slide validator.
 * - `checks.js`: lightweight type-fit + slide-budget checks.
 */

export {
  getRecentValidationLogs,
  clearValidationLogs,
} from './validate-slides/logging.js';

export {
  validateAndFixSlide,
  validateAndFixRefinedSlides,
  diffAppliedFixes,
} from './validate-slides/fix.js';

export {
  RawSlideValidationError,
  validateRefinedSlidesStrict,
} from './validate-slides/strict.js';

export { getUnknownFields } from './validate-slides/fields.js';

export {
  isSlideTypeValid,
  validateSlideCount,
} from './validate-slides/checks.js';
