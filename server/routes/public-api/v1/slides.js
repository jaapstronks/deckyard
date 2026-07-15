/**
 * Public API v1 - Slide-level operations.
 * Handles CRUD operations for individual slides within presentations.
 */

import { updatePresentation } from '../../../storage/presentations.js';
import { methodNotAllowed } from '../../../utils/http.js';
import { newSlide, validateSlide, SLIDE_TYPES } from '../../../../shared/slide-types.js';
import { requireScope, getPresentationWithAccess, parseJsonBody, apiSuccess, apiCreated, apiError } from './middleware.js';
import { emailCanEditCustomHtml, customHtmlEditViolation } from '../../../utils/route-middleware.js';

/**
 * Sanitize a slide for API response.
 */
function sanitizeSlide(slide) {
  if (!slide) return null;
  return {
    id: slide.id,
    type: slide.type,
    content: slide.content || {},
    notes: slide.notes || '',
    parentId: slide.parentId || null,
    visibility: slide.visibility || {},
  };
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/presentations/:presentationId/slides/:slideId - Get a single slide.
 */
async function handleGetSlide(ctx, presentationId, slideId) {
  if (!requireScope(ctx, 'read')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId);
  if (!ok) return true;

  const slides = Array.isArray(pres.slides) ? pres.slides : [];
  const index = slides.findIndex((s) => s?.id === slideId);

  if (index < 0) {
    await apiError(ctx, 404, 'Slide not found');
    return true;
  }

  await apiSuccess(ctx, {
    slide: sanitizeSlide(slides[index]),
    index,
  });
  return true;
}

/**
 * PUT /api/v1/presentations/:presentationId/slides/:slideId - Update a slide (full replacement).
 */
async function handleUpdateSlide(ctx, presentationId, slideId) {
  const { repoRoot, req, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, req);
  if (!bodyOk) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId, { access: 'write' });
  if (!ok) return true;

  const slides = Array.isArray(pres.slides) ? [...pres.slides] : [];
  const index = slides.findIndex((s) => s?.id === slideId);

  if (index < 0) {
    await apiError(ctx, 404, 'Slide not found');
    return true;
  }

  const existingSlide = slides[index];

  // Validate slide type
  const slideType = body.type || existingSlide.type;
  if (!SLIDE_TYPES[slideType]) {
    await apiError(ctx, 400, `Unknown slide type: ${slideType}`);
    return true;
  }

  // Build updated slide, keeping id and parentId from existing
  const updatedSlide = {
    id: slideId,
    type: slideType,
    parentId: existingSlide.parentId || null,
    content: body.content || existingSlide.content || {},
    notes: typeof body.notes === 'string' ? body.notes : (existingSlide.notes || ''),
    visibility: body.visibility || existingSlide.visibility || {},
  };

  // Validate the slide
  const errors = validateSlide(updatedSlide);
  if (errors.length > 0) {
    await apiError(ctx, 400, 'Invalid slide data', { details: errors });
    return true;
  }

  // Gate raw HTML/CSS authoring on the key owner's capability.
  const htmlViolation = customHtmlEditViolation(
    [existingSlide],
    [updatedSlide],
    emailCanEditCustomHtml(apiKey.ownerEmail)
  );
  if (htmlViolation) {
    await apiError(ctx, 403, htmlViolation);
    return true;
  }

  // Replace slide in array
  slides[index] = updatedSlide;

  // Update presentation
  let updated;
  try {
    updated = await updatePresentation(repoRoot, presentationId, { slides }, {
      actorEmail: apiKey.ownerEmail,
    });
  } catch (e) {
    if (e?.statusCode) {
      await apiError(ctx, e.statusCode, e.message);
      return true;
    }
    throw e;
  }

  await apiSuccess(ctx, {
    slide: sanitizeSlide(updatedSlide),
    presentation: {
      id: updated.id,
      revision: updated.revision || 0,
      updatedAt: updated.updatedAt || null,
    },
  });
  return true;
}

/**
 * POST /api/v1/presentations/:presentationId/slides - Create a new slide.
 */
async function handleCreateSlide(ctx, presentationId) {
  const { repoRoot, req, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, req);
  if (!bodyOk) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId, { access: 'write' });
  if (!ok) return true;

  // Validate slide type
  const slideType = body.type;
  if (!slideType || !SLIDE_TYPES[slideType]) {
    await apiError(ctx, 400, `Unknown or missing slide type: ${slideType}`);
    return true;
  }

  // Create new slide
  let newSlideObj;
  try {
    newSlideObj = newSlide({ type: slideType });
  } catch (e) {
    await apiError(ctx, 400, `Failed to create slide: ${e.message}`);
    return true;
  }

  // Override content if provided
  if (body.content && typeof body.content === 'object') {
    newSlideObj.content = { ...newSlideObj.content, ...body.content };
  }

  // Set notes if provided
  if (typeof body.notes === 'string') {
    newSlideObj.notes = body.notes;
  }

  // Set visibility if provided
  if (body.visibility && typeof body.visibility === 'object') {
    newSlideObj.visibility = body.visibility;
  }

  // Validate the new slide
  const errors = validateSlide(newSlideObj);
  if (errors.length > 0) {
    await apiError(ctx, 400, 'Invalid slide data', { details: errors });
    return true;
  }

  // Gate raw HTML/CSS authoring on the key owner's capability.
  const htmlViolation = customHtmlEditViolation(
    [],
    [newSlideObj],
    emailCanEditCustomHtml(apiKey.ownerEmail)
  );
  if (htmlViolation) {
    await apiError(ctx, 403, htmlViolation);
    return true;
  }

  // Determine insertion position
  const slides = Array.isArray(pres.slides) ? [...pres.slides] : [];
  let insertIndex = slides.length; // Default: append at end

  if (typeof body.atIndex === 'number' && body.atIndex >= 0) {
    insertIndex = Math.min(body.atIndex, slides.length);
  } else if (body.afterSlideId) {
    const afterIdx = slides.findIndex((s) => s.id === body.afterSlideId);
    if (afterIdx >= 0) {
      insertIndex = afterIdx + 1;
    }
  }

  // Insert the new slide
  slides.splice(insertIndex, 0, newSlideObj);

  // Update presentation
  let updated;
  try {
    updated = await updatePresentation(repoRoot, presentationId, { slides }, {
      actorEmail: apiKey.ownerEmail,
    });
  } catch (e) {
    if (e?.statusCode) {
      await apiError(ctx, e.statusCode, e.message);
      return true;
    }
    throw e;
  }

  await apiCreated(ctx, {
    slide: sanitizeSlide(newSlideObj),
    index: insertIndex,
    presentation: {
      id: updated.id,
      slideCount: updated.slides?.length || 0,
      revision: updated.revision || 0,
    },
  });
  return true;
}

/**
 * DELETE /api/v1/presentations/:presentationId/slides/:slideId - Delete a slide.
 */
async function handleDeleteSlide(ctx, presentationId, slideId) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId, { access: 'write' });
  if (!ok) return true;

  const slides = Array.isArray(pres.slides) ? [...pres.slides] : [];
  const index = slides.findIndex((s) => s?.id === slideId);

  if (index < 0) {
    await apiError(ctx, 404, 'Slide not found');
    return true;
  }

  // Prevent deleting the last slide
  if (slides.length <= 1) {
    await apiError(ctx, 400, 'Cannot delete the last slide in a presentation');
    return true;
  }

  // Remove the slide
  slides.splice(index, 1);

  // Update presentation
  let updated;
  try {
    updated = await updatePresentation(repoRoot, presentationId, { slides }, {
      actorEmail: apiKey.ownerEmail,
    });
  } catch (e) {
    if (e?.statusCode) {
      await apiError(ctx, e.statusCode, e.message);
      return true;
    }
    throw e;
  }

  await apiSuccess(ctx, {
    deleted: true,
    presentation: {
      id: updated.id,
      slideCount: updated.slides?.length || 0,
      revision: updated.revision || 0,
    },
  });
  return true;
}

/**
 * POST /api/v1/presentations/:presentationId/slides/reorder - Reorder slides.
 */
async function handleReorderSlides(ctx, presentationId) {
  const { repoRoot, req, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, req);
  if (!bodyOk) return true;

  const slideIds = body?.slideIds;
  if (!Array.isArray(slideIds)) {
    await apiError(ctx, 400, 'slideIds must be an array');
    return true;
  }

  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId, { access: 'write' });
  if (!ok) return true;

  const existingSlides = Array.isArray(pres.slides) ? pres.slides : [];
  const slideMap = new Map(existingSlides.map((s) => [s.id, s]));

  // Validate that all provided IDs exist
  const missingIds = slideIds.filter((id) => !slideMap.has(id));
  if (missingIds.length > 0) {
    await apiError(ctx, 400, `Unknown slide IDs: ${missingIds.join(', ')}`);
    return true;
  }

  // Build reordered array (preserving any slides not mentioned)
  const reorderedSlides = [];
  const usedIds = new Set();

  for (const id of slideIds) {
    if (!usedIds.has(id)) {
      reorderedSlides.push(slideMap.get(id));
      usedIds.add(id);
    }
  }

  // Append any slides that weren't in the reorder list
  for (const slide of existingSlides) {
    if (!usedIds.has(slide.id)) {
      reorderedSlides.push(slide);
    }
  }

  // Update presentation
  let updated;
  try {
    updated = await updatePresentation(repoRoot, presentationId, { slides: reorderedSlides }, {
      actorEmail: apiKey.ownerEmail,
    });
  } catch (e) {
    if (e?.statusCode) {
      await apiError(ctx, e.statusCode, e.message);
      return true;
    }
    throw e;
  }

  // Return summary of new order
  const slidesSummary = reorderedSlides.map((s, idx) => ({
    id: s.id,
    type: s.type,
    index: idx,
  }));

  await apiSuccess(ctx, {
    slides: slidesSummary,
    presentation: {
      id: updated.id,
      revision: updated.revision || 0,
    },
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Main handler for /api/v1/presentations/:id/slides routes.
 */
export async function handleSlides(ctx) {
  const { req, res, url } = ctx;

  // POST /api/v1/presentations/:id/slides/reorder
  const reorderMatch = url.pathname.match(
    /^\/api\/v1\/presentations\/([^/]+)\/slides\/reorder$/
  );
  if (reorderMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    return handleReorderSlides(ctx, reorderMatch[1]);
  }

  // Single slide operations: GET, PUT, DELETE /api/v1/presentations/:id/slides/:slideId
  const singleSlideMatch = url.pathname.match(
    /^\/api\/v1\/presentations\/([^/]+)\/slides\/([^/]+)$/
  );
  if (singleSlideMatch) {
    const [, presentationId, slideId] = singleSlideMatch;

    // Exclude 'reorder' and 'from-library' which are handled separately
    if (slideId === 'reorder' || slideId === 'from-library') {
      return false;
    }

    if (req.method === 'GET') return handleGetSlide(ctx, presentationId, slideId);
    if (req.method === 'PUT') return handleUpdateSlide(ctx, presentationId, slideId);
    if (req.method === 'DELETE') return handleDeleteSlide(ctx, presentationId, slideId);
    return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
  }

  // Collection: POST /api/v1/presentations/:id/slides
  const collectionMatch = url.pathname.match(
    /^\/api\/v1\/presentations\/([^/]+)\/slides$/
  );
  if (collectionMatch) {
    if (req.method === 'POST') return handleCreateSlide(ctx, collectionMatch[1]);
    return methodNotAllowed(res, ['POST']);
  }

  return false;
}
