/**
 * Public API v1 - Slide-level operations.
 * Handles CRUD operations for individual slides within presentations.
 */

import { publicDeckTimestamps } from '../../../services/presentations.js';
import {
  updateSlide,
  addSlide,
  removeSlide,
  reorderSlides,
} from '../../../services/slides.js';
import { canonicalSlideType } from '../../../../shared/slide-types.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  getPresentationWithAccess,
  readApiV1Body,
  apiSuccess,
  apiCreated,
  apiError,
} from './middleware.js';
import {
  getOptionalString,
  getOptionalObject,
  getNonNegativeNumber,
} from '../../../utils/request-validators.js';

/**
 * Sanitize a slide for API response.
 */
function sanitizeSlide(slide) {
  if (!slide) return null;
  return {
    id: slide.id,
    // Published spelling (canonical id) on the wire; storage keeps the key.
    type: canonicalSlideType(slide.type),
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
  if (!requirePermission(ctx, 'read')) return true;

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
 * PUT /api/v1/presentations/:presentationId/slides/:slideId - Update a slide:
 * a full replacement, or with `type` and no `content` a conversion (B458).
 */
async function handleUpdateSlide(ctx, presentationId, slideId) {
  if (!requirePermission(ctx, 'write')) return true;
  const { ok: bodyOk, body } = await readApiV1Body(ctx, ctx.req);
  if (!bodyOk) return true;
  const { slide, presentation } = await updateSlide(
    ctx.storageScope,
    { actor: ctx.authedUser },
    {
      presentationId,
      slideId,
      type: body.type,
      content: body.content,
      conversion: body.content ? 'replace' : 'mapped',
      notes: getOptionalString(body, 'notes') ?? undefined,
      visibility: body.visibility,
    },
  );

  await apiSuccess(ctx, {
    slide: sanitizeSlide(slide),
    presentation: {
      id: presentation.id,
      revision: presentation.revision || 0,
      updatedAt: publicDeckTimestamps(presentation).updatedAt,
    },
  });
  return true;
}

/**
 * POST /api/v1/presentations/:presentationId/slides - Create a new slide.
 */
async function handleCreateSlide(ctx, presentationId) {
  if (!requirePermission(ctx, 'write')) return true;
  const { ok: bodyOk, body } = await readApiV1Body(ctx, ctx.req);
  if (!bodyOk) return true;
  const { slide, index, presentation } = await addSlide(
    ctx.storageScope,
    { actor: ctx.authedUser },
    {
      presentationId,
      type: body.type,
      content: getOptionalObject(body, 'content'),
      notes: getOptionalString(body, 'notes') ?? undefined,
      visibility: getOptionalObject(body, 'visibility') ?? undefined,
      atIndex: getNonNegativeNumber(body, 'atIndex'),
      afterSlideId: body.afterSlideId,
    },
  );

  await apiCreated(ctx, {
    slide: sanitizeSlide(slide),
    index,
    presentation: {
      id: presentation.id,
      slideCount: presentation.slides?.length || 0,
      revision: presentation.revision || 0,
    },
  });
  return true;
}

/**
 * DELETE /api/v1/presentations/:presentationId/slides/:slideId - Delete a slide.
 */
async function handleDeleteSlide(ctx, presentationId, slideId) {
  if (!requirePermission(ctx, 'write')) return true;
  const { presentation } = await removeSlide(
    ctx.storageScope,
    { actor: ctx.authedUser },
    { presentationId, slideId },
  );

  await apiSuccess(ctx, {
    deleted: true,
    presentation: {
      id: presentation.id,
      slideCount: presentation.slides?.length || 0,
      revision: presentation.revision || 0,
    },
  });
  return true;
}

/**
 * POST /api/v1/presentations/:presentationId/slides/reorder - Reorder slides.
 */
async function handleReorderSlides(ctx, presentationId) {
  if (!requirePermission(ctx, 'write')) return true;
  const { ok: bodyOk, body } = await readApiV1Body(ctx, ctx.req);
  if (!bodyOk) return true;
  const { slides, presentation } = await reorderSlides(
    ctx.storageScope,
    { actor: ctx.authedUser },
    { presentationId, slideIds: body?.slideIds },
  );

  // Return summary of new order
  const slidesSummary = slides.map((s, idx) => ({
    id: s.id,
    type: canonicalSlideType(s.type),
    index: idx,
  }));

  await apiSuccess(ctx, {
    slides: slidesSummary,
    presentation: {
      id: presentation.id,
      revision: presentation.revision || 0,
    },
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Slide routes; a known path with another method answers 405.
 *
 * `/slides/reorder` sits above `/slides/:slideId` and answers every method
 * itself, so `reorder` never reaches the single-slide rows; `from-library`
 * is the slide-library module's, which the v1 router walks before this one.
 * Slide ids are author-chosen strings (migration 051), hence `text`.
 */
export const ROUTES = [
  {
    method: 'POST',
    id: 'reorderSlides',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides\/reorder$/,
    captures: ['uuid'],
    handler: handleReorderSlides,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides\/reorder$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['POST']),
  },
  {
    method: 'GET',
    id: 'getSlide',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides\/([^/]+)$/,
    captures: ['uuid', 'text'],
    handler: handleGetSlide,
  },
  {
    method: 'PUT',
    id: 'updateSlide',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides\/([^/]+)$/,
    captures: ['uuid', 'text'],
    handler: handleUpdateSlide,
  },
  {
    method: 'DELETE',
    id: 'deleteSlide',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides\/([^/]+)$/,
    captures: ['uuid', 'text'],
    handler: handleDeleteSlide,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides\/([^/]+)$/,
    captures: ['uuid', 'text'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET', 'PUT', 'DELETE']),
  },
  {
    method: 'POST',
    id: 'createSlide',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides$/,
    captures: ['uuid'],
    handler: handleCreateSlide,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['POST']),
  },
];

/**
 * Main handler for /api/v1/presentations/:id/slides routes.
 */
export const handleSlides = withV1ErrorHandler('public-api-v1:slides', (ctx) =>
  dispatchV1Routes(ROUTES, ctx),
);
