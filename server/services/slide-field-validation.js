/** Declared slide-field refusals shared by whole-deck and slide writes. */
import { validateSlideFields } from '../../shared/slide-types/presentation.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import { canonicalJson } from '../../shared/slide-fingerprint.js';
import { refuseNonCanonicalVersionKeys } from '../storage/presentations/index.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { AppError } from '../utils/errors.js';

/**
 * Refuse the first problem with the slide's content, retaining all of its
 * diagnostics: a key its type does not declare is 400 `unknown_field`, an
 * invalid declared field 400 `invalid`, each naming the key in
 * `details.field`.
 * @param {Object} slide
 * @param {Record<string, Object>} slideTypes
 * @param {{lang?: string, allowMissingTranslationText?: boolean, previousSlide?: Object}} [location]
 */
export function assertValidSlideFields(slide, slideTypes, location = {}) {
  const {
    allowMissingTranslationText = false,
    previousSlide,
    ...details
  } = location;
  const problem = validateSlideFields(slide, {
    slideTypes,
    allowMissingTranslationText,
    previousSlide,
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

/** What the field validation reads of a slide. */
const declaredFields = (slide) =>
  canonicalJson({ type: slide?.type, content: slide?.content });

/**
 * Refuse the first problem in the new or changed slides of a whole-deck write,
 * in each submitted language, the active one first. The editor's save and the
 * collab store both write this way.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {Object} pres - The deck as stored.
 * @param {Object} changes - The submitted `slides` and `i18n`.
 * @param {{live?: boolean}} [opts] - The write is a collab doc's projection.
 *   A live document passes through an empty required field while someone
 *   retypes it, so prose may be missing in every language; present values keep
 *   every other rule. And a projection is not byte-equal to the stored slide (it
 *   adds an empty `notes`), so a slide counts as changed by its type and content
 *   alone: an old value on a slide nobody touched holds nothing back.
 */
export async function assertChangedSlideFields(
  scope,
  pres,
  changes,
  { live = false } = {},
) {
  const versions = changes.i18n?.versions || {};
  refuseNonCanonicalVersionKeys(versions);
  const active = normalizeLang(changes.i18n?.active);
  const dominant = normalizeLang(pres.i18n?.dominant || pres.lang);
  const buffers = Object.entries(versions)
    .filter(([lang]) => lang !== active || !Array.isArray(changes.slides))
    .map(([lang, version]) => ({
      slides: version?.slides,
      before: pres.i18n?.versions?.[lang]?.slides || [],
      lang,
    }));
  if (Array.isArray(changes.slides)) {
    buffers.push({
      slides: changes.slides,
      before: active
        ? pres.i18n?.versions?.[active]?.slides || []
        : pres.slides,
      ...(active ? { lang: active } : {}),
    });
  }
  if (!buffers.some(({ slides }) => Array.isArray(slides))) return;
  // The author reads the version on screen: a value every version shares (a
  // link) is refused there, not in the first version that carries it (B879).
  buffers.sort((a, b) => (b.lang === active) - (a.lang === active));
  const slideTypes = await buildMergedSlideTypes(scope);
  for (const { slides, before, lang } of buffers) {
    const stored = new Map((before || []).map((s) => [s.id, s]));
    for (const slide of Array.isArray(slides) ? slides : []) {
      const previous = stored.get(slide?.id);
      if (
        live
          ? declaredFields(previous) === declaredFields(slide)
          : canonicalJson(previous) === canonicalJson(slide)
      )
        continue;
      assertValidSlideFields(slide, slideTypes, {
        ...(lang ? { lang } : {}),
        allowMissingTranslationText: live || (!!lang && lang !== dominant),
        previousSlide: previous,
      });
    }
  }
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
