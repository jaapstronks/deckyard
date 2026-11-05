/** Declared slide-field refusals shared by whole-deck and slide writes. */
import { validateSlideFields } from '../../shared/slide-types/presentation.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import { canonicalJson } from '../../shared/slide-fingerprint.js';
import { refuseNonCanonicalVersionKeys } from '../storage/presentations/index.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { AppError } from '../utils/errors.js';
import { LlmError } from '../utils/llm/error.js';

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
  // `parts` locates refusals inside a list for the collab hold-back; the
  // refusal names the field and its sentences say where.
  const { code = 'invalid', parts, ...diagnostics } = problem;
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
 * The slide buffers of a whole-deck write, each beside what is stored for it,
 * the version on screen first: a value every version shares (a link) is
 * reported there, not in the first version that carries it (B879).
 *
 * @param {Object} pres - The deck as stored.
 * @param {Object} changes - The submitted `slides` and `i18n`.
 * @returns {Array<{slides: unknown, before: Array<Object>, lang?: string}>}
 */
function submittedSlideBuffers(pres, changes) {
  const versions = changes.i18n?.versions || {};
  refuseNonCanonicalVersionKeys(versions);
  const active = normalizeLang(changes.i18n?.active);
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
  return buffers.sort((a, b) => (b.lang === active) - (a.lang === active));
}

/**
 * Refuse the first problem in the new or changed slides of an editor save, in
 * each submitted language, the active one first.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {Object} pres - The deck as stored.
 * @param {Object} changes - The submitted `slides` and `i18n`.
 */
export async function assertChangedSlideFields(scope, pres, changes) {
  const buffers = submittedSlideBuffers(pres, changes);
  if (!buffers.some(({ slides }) => Array.isArray(slides))) return;
  const dominant = normalizeLang(pres.i18n?.dominant || pres.lang);
  const slideTypes = await buildMergedSlideTypes(scope);
  for (const { slides, before, lang } of buffers) {
    const stored = new Map((before || []).map((s) => [s.id, s]));
    for (const slide of Array.isArray(slides) ? slides : []) {
      const previous = stored.get(slide?.id);
      if (canonicalJson(previous) === canonicalJson(slide)) continue;
      assertValidSlideFields(slide, slideTypes, {
        ...(lang ? { lang } : {}),
        allowMissingTranslationText: !!lang && lang !== dominant,
        previousSlide: previous,
      });
    }
  }
}

/** What the field validation reads of a slide. */
const declaredFields = (slide) =>
  canonicalJson({ type: slide?.type, content: slide?.content });

/** The value at `path` inside `value`, or undefined where the path breaks. */
function valueAt(value, path) {
  let at = value;
  for (const step of path) {
    if (!at || typeof at !== 'object') return undefined;
    at = at[step];
  }
  return at;
}

/**
 * Leave the leaf at `path` out of a copy of `list`, copying only the objects on
 * the way to it.
 * @param {Array<Object>} list
 * @param {Array<number|string>} path - Item index and sub-field, alternating.
 * @returns {Array<Object>}
 */
function withoutLeaf(list, path) {
  const [index, key, ...rest] = path;
  const item = list[index];
  if (!item || typeof item !== 'object' || !Object.hasOwn(item, key))
    return list;
  const copy = [...list];
  const next = { ...item };
  if (rest.length && Array.isArray(item[key]))
    next[key] = withoutLeaf(item[key], rest);
  else delete next[key];
  copy[index] = next;
  return copy;
}

/**
 * A list field with its refused item sub-fields left out. A refused sub-field
 * is dropped from its item, never restored from the stored list: items have
 * no identity beyond their index, so after a reorder a stored value would land
 * on another item. A sub-value equal to the stored one at the same place stops
 * nothing.
 * @param {Array<Object>} list - The list as the doc holds it.
 * @param {unknown} stored - The stored list of this field, if its type held.
 * @param {Array<{path: Array<number|string>, errors: string[]}>} parts
 * @param {(part: {path: Array<number|string>, errors: string[], value: unknown}) => void} refuse
 * @returns {Array<Object>}
 */
function holdBackItemParts(list, stored, parts, refuse) {
  let held = list;
  for (const { path, errors } of parts) {
    const value = valueAt(list, path);
    if (canonicalJson(value) === canonicalJson(valueAt(stored, path))) continue;
    held = withoutLeaf(held, path);
    // A required sub-field nobody filled in is already absent: nothing held.
    if (value === undefined) continue;
    refuse({ path, errors, value });
  }
  return held;
}

/**
 * One slide of a collab projection with its refused fields held back: a refused
 * field keeps its stored value, and without one (a new slide, a changed type)
 * it is left out. Inside a list the hold is per item sub-field
 * ({@link holdBackItemParts}); a refusal of the list itself keeps the stored
 * list.
 *
 * @param {Object} slide
 * @param {Object|undefined} previous - The stored slide with this id.
 * @param {Record<string, Object>} slideTypes
 * @param {Array<Object>} refused - Collects what was held back.
 * @returns {Object} The slide to write; `slide` itself when nothing changed.
 */
function holdBackSlideFields(slide, previous, slideTypes, refused) {
  if (declaredFields(previous) === declaredFields(slide)) return slide;
  const problems = validateSlideFields(slide, {
    slideTypes,
    // A live document passes through an empty field while someone retypes it.
    allowMissingTranslationText: true,
    previousSlide: previous,
  });
  if (!problems.length) return slide;
  const stored = previous?.type === slide.type ? previous.content : null;
  const content = { ...slide.content };
  for (const { field, errors, parts } of problems) {
    if (parts?.length && parts.every((part) => part.path.length)) {
      content[field] = holdBackItemParts(
        slide.content[field],
        stored?.[field],
        parts,
        ({ path, errors: partErrors, value }) =>
          refused.push({
            slideId: slide.id,
            field,
            path,
            errors: partErrors,
            value,
          }),
      );
      continue;
    }
    if (stored && Object.hasOwn(stored, field)) content[field] = stored[field];
    else delete content[field];
    // A stored value that no longer passes, or a required field nobody filled
    // in, stops nothing: the JSON gets what the doc holds.
    if (canonicalJson(content[field]) === canonicalJson(slide.content?.[field]))
      continue;
    refused.push({
      slideId: slide.id,
      field,
      path: [],
      errors,
      value: slide.content?.[field],
    });
  }
  return { ...slide, content };
}

/**
 * The deck a collab store may write, with what the field validation refuses
 * held back per field. The doc is what peers typed, and it passes through
 * states no save would send, so a refusal must not stop the rest of the store:
 * the doc binary is a cache that any write from outside the doc deletes, so
 * whatever misses the JSON can be lost. The refused value itself never reaches
 * the JSON.
 *
 * Differs from {@link assertChangedSlideFields} in one more way. A projection
 * is not byte-equal to the stored slide (it adds an empty `notes`), so a slide
 * counts as changed by its type and content alone.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {Object} pres - The deck as stored.
 * @param {Object} projected - The doc's projection.
 * @returns {Promise<{deck: Object, refused: Array<{slideId: string, field: string, path: Array<number|string>, errors: string[], value: unknown}>}>}
 *   `path` is empty for a field, item index and sub-field inside a list.
 */
export async function holdBackRefusedSlideFields(scope, pres, projected) {
  const buffers = submittedSlideBuffers(pres, projected);
  const slideTypes = await buildMergedSlideTypes(scope);
  const refused = [];
  const heldBack = new Map();
  for (const { slides, before } of buffers) {
    if (!Array.isArray(slides)) continue;
    const stored = new Map((before || []).map((s) => [s.id, s]));
    heldBack.set(
      slides,
      slides.map((slide) =>
        holdBackSlideFields(slide, stored.get(slide?.id), slideTypes, refused),
      ),
    );
  }
  const active = normalizeLang(projected.i18n?.active);
  const deck = { ...projected };
  if (Array.isArray(projected.slides))
    deck.slides = heldBack.get(projected.slides);
  if (projected.i18n?.versions) {
    deck.i18n = {
      ...projected.i18n,
      versions: Object.fromEntries(
        Object.entries(projected.i18n.versions).map(([lang, version]) => [
          lang,
          {
            ...version,
            slides:
              lang === active && Array.isArray(projected.slides)
                ? deck.slides
                : (heldBack.get(version?.slides) ?? version?.slides),
          },
        ]),
      ),
    };
  }
  return { deck, refused };
}

/**
 * Refuse a model's answer whose slide fails the field validation. Nothing is
 * wrong with the caller's request and a retry can succeed, so this is the
 * failing-model answer, 502 `bad_gateway`, naming the field. For answers
 * nobody reviews before they are used; a write refuses through
 * {@link assertValidSlideFields}.
 *
 * @param {Array<Object>} slides
 * @param {Record<string, Object>} slideTypes
 * @param {{phase: string, vendor?: string|null}} location
 */
export function assertValidModelSlides(slides, slideTypes, { phase, vendor }) {
  for (const slide of slides) {
    const [problem] = validateSlideFields(slide, { slideTypes });
    if (!problem) continue;
    const { field, errors } = problem;
    throw new LlmError(
      `The model answered a slide that cannot be used: ${errors.join('; ')}`,
      {
        phase,
        vendor,
        details: { field, errors, ...(slide.id ? { slideId: slide.id } : {}) },
      },
    );
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
