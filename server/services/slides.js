/** Slide mutations shared by the public API and MCP (B572, B611). */

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
  AppError,
  NotFoundError,
  ValidationError,
  throwStorageFailure,
} from '../utils/errors.js';
import { dominantSlidesBody } from './deck-versions.js';
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

/** `index` as a position in `slides`, or `ErrorType` naming the valid range. */
function indexIn(slides, index, name, ErrorType) {
  if (!Number.isInteger(index) || index < 0 || index >= slides.length) {
    throw new ErrorType(
      `${name} ${index} out of range (0-${slides.length - 1})`,
    );
  }
  return index;
}

function slideAt(slides, { slideId, slideIndex }) {
  if (slideId === undefined)
    return indexIn(slides, slideIndex, 'Slide index', NotFoundError);
  const index = slides.findIndex((slide) => slide?.id === slideId);
  if (index < 0) throw new NotFoundError('Slide not found');
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
 * Store a new dominant slide buffer without replacing unrelated deck columns
 * or another language version ({@link dominantSlidesBody}).
 */
async function persistSlides(scope, identity, pres, slides) {
  const body = dominantSlidesBody(pres, slides);
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

/**
 * Insert `slide` right after the slide at `anchorIndex`, in the anchor's
 * group: next to a child it lands as a sibling child, next to a top-level
 * slide it stays top level (D325, the same rule as the editor's insert row).
 * Mutates `slides` and answers the new slide's index.
 *
 * @param {Array<Object>} slides
 * @param {Object} slide
 * @param {number} anchorIndex
 * @returns {number}
 */
export function insertAfterAnchor(slides, slide, anchorIndex) {
  const parentId = slides[anchorIndex]?.parentId || null;
  if (parentId) slide.parentId = parentId;
  slides.splice(anchorIndex + 1, 0, slide);
  return anchorIndex + 1;
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
  const after = afterSlideId
    ? slides.findIndex((candidate) => candidate.id === afterSlideId)
    : -1;
  let index;
  if (atIndex !== undefined && atIndex !== null) {
    index = Math.min(atIndex, slides.length);
    slides.splice(index, 0, slide);
  } else if (position !== undefined && position !== null) {
    index = Math.max(0, Math.min(position, slides.length));
    slides.splice(index, 0, slide);
  } else if (after >= 0) {
    index = insertAfterAnchor(slides, slide, after);
  } else {
    index = slides.push(slide) - 1;
  }
  const presentation = await persistSlides(scope, identity, pres, slides);
  return { slide, index, presentation };
}

/**
 * Remove a slide, addressed by id (v1) or index (MCP), refusing to leave a
 * deck empty. Answers the removed slide so a contract can describe it.
 */
export async function removeSlide(
  scope,
  identity,
  { presentationId, slideId, slideIndex },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const slides = [...(pres.slides || [])];
  const index = slideAt(slides, { slideId, slideIndex });
  if (slides.length <= 1)
    throw new ValidationError('Cannot delete the last slide in a presentation');
  const [slide] = slides.splice(index, 1);
  const presentation = await persistSlides(scope, identity, pres, slides);
  return { slide, index, presentation };
}

/** The slide ids in order after moving the slide at `fromIndex` to `toIndex`. */
function movedSlideIds(slides, move) {
  const { fromIndex, toIndex } = move || {};
  indexIn(slides, fromIndex, 'fromIndex', NotFoundError);
  indexIn(slides, toIndex, 'toIndex', ValidationError);
  const ids = slides.map((slide) => slide.id);
  const [id] = ids.splice(fromIndex, 1);
  ids.splice(toIndex, 0, id);
  return ids;
}

/**
 * Reorder a deck's slides: `slideIds` names a new order (v1; unmentioned
 * slides keep their old order after it), `move` moves one slide from one
 * position to another (MCP). Exactly one of the two.
 */
export async function reorderSlides(
  scope,
  identity,
  { presentationId, slideIds, move },
) {
  if (move !== undefined && slideIds !== undefined)
    throw new ValidationError('Send slideIds or move, not both');
  if (move === undefined && !Array.isArray(slideIds))
    throw new ValidationError('slideIds must be an array');
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const existing = pres.slides || [];
  const order = move === undefined ? slideIds : movedSlideIds(existing, move);
  const byId = new Map(existing.map((slide) => [slide.id, slide]));
  const missing = order.filter((id) => !byId.has(id));
  if (missing.length)
    throw new ValidationError(`Unknown slide IDs: ${missing.join(', ')}`);
  const seen = new Set();
  const slides = [];
  for (const id of order) {
    if (!seen.has(id)) slides.push(byId.get(id));
    seen.add(id);
  }
  for (const slide of existing) if (!seen.has(slide.id)) slides.push(slide);
  const presentation = await persistSlides(scope, identity, pres, slides);
  return { slides, presentation };
}

/**
 * Replace a deck's whole slide set with one an input step composed (MCP
 * `append_slides`, `compress_presentation`, `iterate_presentation`, whose
 * model call runs before this). A slide unchanged from the stored deck passes
 * as it is; a new or changed one passes the same strict validation as
 * {@link updateSlide}, under its canonical type key. Refuses an empty set and
 * a repeated id; the write keeps the other language versions, the active
 * language and the deck metadata ({@link persistSlides}).
 */
export async function replaceSlides(
  scope,
  identity,
  { presentationId, slides },
) {
  if (!Array.isArray(slides))
    throw new ValidationError('slides must be an array');
  if (slides.length === 0)
    throw new ValidationError('Cannot leave a presentation without slides');
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const stored = new Map(
    (pres.slides || []).map((slide) => [slide?.id, JSON.stringify(slide)]),
  );
  const slideTypes = await buildMergedSlideTypes(scope);
  const seen = new Set();
  const next = slides.map((slide) => {
    if (slide?.id !== undefined && seen.has(slide.id))
      throw new ValidationError(`Duplicate slide id: ${slide.id}`);
    seen.add(slide?.id);
    if (stored.get(slide?.id) === JSON.stringify(slide)) return slide;
    const type = resolveSlideTypeName(slide?.type, slideTypes);
    if (!type) throw new ValidationError(`Unknown slide type: ${slide?.type}`);
    const candidate = { ...slide, type };
    assertValidSlide(candidate, slideTypes);
    return candidate;
  });
  const presentation = await persistSlides(scope, identity, pres, next);
  return { slides: next, presentation };
}
