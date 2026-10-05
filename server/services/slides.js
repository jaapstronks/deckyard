/** Slide mutations shared by the public API and MCP (B572). */

import { updatePresentation } from '../storage/presentations/index.js';
import { resolveIdentityByEmail } from '../storage/identity-resolver.js';
import {
  canonicalSlideType,
  convertSlideToType,
  newSlide,
  resolveSlideTypeName,
  UnsupportedConversionError,
  validateSlide,
} from '../../shared/slide-types.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { loadDeckTheme } from '../utils/themes.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
  TRANSLATION_LANGS,
} from '../../shared/i18n-utils.js';
import {
  AppError,
  NotFoundError,
  ValidationError,
  throwStorageFailure,
} from '../utils/errors.js';
import { loadPresentationForActor } from './presentations.js';

async function writeOptions({ actor }) {
  if (actor?.unrestricted) return { bypassLockCheck: true };
  const actorUserId =
    actor?.id ||
    (actor?.email ? (await resolveIdentityByEmail(actor.email))?.userId : null);
  return { actorEmail: actor?.email || null, actorUserId: actorUserId || null };
}

function assertValidSlide(slide, slideTypes) {
  const errors = validateSlide(slide, { slideTypes });
  if (errors.length) {
    throw new ValidationError('Invalid slide data', { errors });
  }
}

function slideAt(slides, { slideId, slideIndex }) {
  const index =
    slideId === undefined
      ? slideIndex
      : slides.findIndex((slide) => slide?.id === slideId);
  if (!Number.isInteger(index) || index < 0 || index >= slides.length) {
    throw new NotFoundError('Slide not found');
  }
  return index;
}

function refuseUnsupportedConversion(err) {
  const { from, to, convertible } = err.details;
  throw new AppError(
    `Cannot change slide type from ${canonicalSlideType(from)} to ${canonicalSlideType(to)}: no conversion is declared for that pair. Send content for the new type to replace the slide, or create a new slide of that type.`,
    400,
    {
      from: canonicalSlideType(from),
      to: canonicalSlideType(to),
      convertible: convertible.map(canonicalSlideType),
    },
    'unsupported_conversion',
  );
}

/**
 * Store a change to the dominant slide buffer without replacing unrelated deck
 * columns. Storage interprets top-level slides as the active language on input,
 * then projects the dominant language back to the top level. A deck can retain
 * a different active language, so feed that version's unchanged buffer through
 * the input fields while updating the dominant version explicitly.
 */
async function persistSlides(scope, identity, pres, slides) {
  let body = { slides };
  const i18n = pres.i18n;
  if (i18n?.versions && Object.keys(i18n.versions).length > 0) {
    const dominant =
      normalizeLang(i18n.dominant) ||
      normalizeLang(i18n.active) ||
      TRANSLATION_LANGS.find((lang) => i18n.versions[lang]) ||
      DEFAULT_DECK_LANG;
    const active = normalizeLang(i18n.active);
    const copy = structuredClone(i18n);
    const versions = copy.versions;
    versions[dominant] = {
      ...(versions[dominant] || {}),
      title: pres.title,
      slides,
    };
    const activeVersion =
      active && active !== dominant ? versions[active] : null;
    body = {
      id: pres.id,
      title: activeVersion?.title ?? pres.title,
      slides: activeVersion?.slides ?? slides,
      i18n: copy,
    };
  }
  const result = await updatePresentation(
    scope,
    pres.id,
    body,
    await writeOptions(identity),
  );
  if (!result) throw new NotFoundError('Presentation not found');
  if (result.ok === false) {
    throwStorageFailure(
      result,
      result.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join('; ') || `Could not save slides: ${result.reason}`,
    );
  }
  return result;
}

/**
 * Update one slide. `contentMode` describes the contract's input (v1 replaces,
 * MCP patches); `normalizeContent` is MCP's optional fix-mode input step. Every
 * resulting slide then passes the same strict validation before storage.
 */
export async function updateSlide(scope, identity, input) {
  const {
    presentationId,
    slideId,
    slideIndex,
    type,
    content,
    contentMode = 'replace',
    conversion = 'mapped',
    notes,
    visibility,
    normalizeContent,
  } = input;
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const slides = [...(pres.slides || [])];
  const index = slideAt(slides, { slideId, slideIndex });
  const existing = slides[index];
  const slideTypes = await buildMergedSlideTypes(scope);
  const rawType = type || existing.type;
  const slideType = resolveSlideTypeName(rawType, slideTypes);
  if (!slideType) throw new ValidationError(`Unknown slide type: ${rawType}`);

  let converted = existing;
  if (slideType !== existing.type && conversion === 'mapped') {
    try {
      converted = convertSlideToType(existing, slideType, {
        slideTypes,
        lang: pres.lang,
        theme: await loadDeckTheme(scope.repoRoot, pres.theme, scope),
      });
    } catch (err) {
      if (err instanceof UnsupportedConversionError)
        refuseUnsupportedConversion(err);
      throw err;
    }
  }
  let nextContent =
    content === undefined
      ? converted.content || {}
      : contentMode === 'merge'
        ? { ...converted.content, ...content }
        : content;
  if (normalizeContent) {
    nextContent = normalizeContent(
      { type: slideType, content: nextContent },
      slideTypes,
    );
  }
  const slide = {
    ...existing,
    type: slideType,
    content: nextContent,
    ...(notes !== undefined ? { notes } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
  };
  assertValidSlide(slide, slideTypes);
  slides[index] = slide;
  const presentation = await persistSlides(scope, identity, pres, slides);
  return { slide, index, presentation };
}

/** Add one factory-composed slide, with the same final validation on both contracts. */
export async function addSlide(scope, identity, input) {
  const {
    presentationId,
    type,
    content,
    notes,
    visibility,
    atIndex,
    afterSlideId,
    position,
  } = input;
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const slideTypes = await buildMergedSlideTypes(scope);
  const slideType = type && resolveSlideTypeName(type, slideTypes);
  if (!slideType)
    throw new ValidationError(`Unknown or missing slide type: ${type}`);
  let slide;
  try {
    slide = newSlide({
      type: slideType,
      content,
      slideTypes,
      theme: await loadDeckTheme(scope.repoRoot, pres.theme, scope),
      lang: pres.lang,
      presentationId,
    });
  } catch (err) {
    throw new ValidationError(`Failed to create slide: ${err.message}`);
  }
  if (notes !== undefined) slide.notes = notes;
  if (visibility !== undefined) slide.visibility = visibility;
  assertValidSlide(slide, slideTypes);

  const slides = [...(pres.slides || [])];
  let index = slides.length;
  if (atIndex !== undefined && atIndex !== null)
    index = Math.min(atIndex, slides.length);
  else if (position !== undefined && position !== null)
    index = Math.max(0, Math.min(position, slides.length));
  else if (afterSlideId) {
    const after = slides.findIndex(
      (candidate) => candidate.id === afterSlideId,
    );
    if (after >= 0) index = after + 1;
  }
  slides.splice(index, 0, slide);
  const presentation = await persistSlides(scope, identity, pres, slides);
  return { slide, index, presentation };
}

/** Remove a slide, refusing to leave a deck empty. */
export async function removeSlide(
  scope,
  identity,
  { presentationId, slideId },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const slides = [...(pres.slides || [])];
  const index = slideAt(slides, { slideId });
  if (slides.length <= 1)
    throw new ValidationError('Cannot delete the last slide in a presentation');
  slides.splice(index, 1);
  const presentation = await persistSlides(scope, identity, pres, slides);
  return { presentation };
}

/** Reorder the named slides, keeping unmentioned slides in their old order. */
export async function reorderSlides(
  scope,
  identity,
  { presentationId, slideIds },
) {
  if (!Array.isArray(slideIds))
    throw new ValidationError('slideIds must be an array');
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const existing = pres.slides || [];
  const byId = new Map(existing.map((slide) => [slide.id, slide]));
  const missing = slideIds.filter((id) => !byId.has(id));
  if (missing.length)
    throw new ValidationError(`Unknown slide IDs: ${missing.join(', ')}`);
  const seen = new Set();
  const slides = [];
  for (const id of slideIds) {
    if (!seen.has(id)) slides.push(byId.get(id));
    seen.add(id);
  }
  for (const slide of existing) if (!seen.has(slide.id)) slides.push(slide);
  const presentation = await persistSlides(scope, identity, pres, slides);
  return { slides, presentation };
}
