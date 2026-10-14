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

/**
 * Refuse a new deck's first invalid declared field, across its language
 * versions: the source language must satisfy every declared rule, another
 * version may leave prose untranslated (the editor's rule for a save). The
 * refusal names the version, the slide's position in it and the field, so an
 * import says which slide it refuses instead of dropping the value (B693).
 *
 * @param {Array<{lang?: string, slides?: Array<Object>}>} versions
 * @param {Record<string, Object>} slideTypes
 * @param {{dominant?: string|null}} [opts] - The source language; without it
 *   every version is held to the source rules.
 */
export function assertValidNewDeckSlides(
  versions,
  slideTypes,
  { dominant = null } = {},
) {
  for (const { lang, slides } of versions) {
    (Array.isArray(slides) ? slides : []).forEach((slide, index) => {
      assertValidSlideFields(slide, slideTypes, {
        index,
        ...(lang ? { lang } : {}),
        allowMissingTranslationText: !!dominant && !!lang && lang !== dominant,
      });
    });
  }
}
