/** Declared slide-field refusals shared by whole-deck and slide writes. */
import { validateSlideFields } from '../../shared/slide-types/presentation.js';
import { AppError } from '../utils/errors.js';

/**
 * Refuse the first invalid declared field, retaining all of its diagnostics.
 * @param {Object} slide
 * @param {Record<string, Object>} slideTypes
 * @param {{lang?: string, allowMissingTranslationText?: boolean}} [location]
 */
export function assertValidSlideFields(slide, slideTypes, location = {}) {
  const { allowMissingTranslationText = false, ...details } = location;
  const problem = validateSlideFields(slide, {
    slideTypes,
    allowMissingTranslationText,
  })[0];
  if (!problem) return;
  throw new AppError(
    problem.errors.join('; '),
    400,
    {
      ...problem,
      slideId: slide.id,
      ...details,
    },
    'invalid',
  );
}
