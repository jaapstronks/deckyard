/** Declared slide-field refusals shared by whole-deck and slide writes. */
import { validateSlideFields } from '../../shared/slide-types/presentation.js';
import { AppError } from '../utils/errors.js';

/**
 * Refuse the first problem with the slide's content, retaining all of its
 * diagnostics: a key its type does not declare is 400 `unknown_field`, an
 * invalid declared field 400 `invalid`, each naming the key in
 * `details.field`.
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
  const { code = 'invalid', ...diagnostics } = problem;
  throw new AppError(
    diagnostics.errors.join('; '),
    400,
    {
      ...diagnostics,
      slideId: slide.id,
      ...details,
    },
    code,
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

/**
 * {@link assertValidNewDeckSlides} for an imported deck as
 * `deckToPresentationParts` composed it: `slides` in the deck's language,
 * `translations[lang].slides` beside them. The JSON import and the `.deck`
 * bundle import both call it before they create anything.
 *
 * @param {{slides?: Array<Object>, translations?: Record<string, {slides?: Array<Object>}>}} parts
 * @param {Record<string, Object>} slideTypes
 * @param {{lang: string}} opts - The deck's language.
 */
export function assertValidImportedDeck(parts, slideTypes, { lang }) {
  assertValidNewDeckSlides(
    [
      { lang, slides: parts?.slides },
      ...Object.entries(parts?.translations || {}).map(([l, version]) => ({
        lang: l,
        slides: version?.slides,
      })),
    ],
    slideTypes,
    { dominant: lang },
  );
}
