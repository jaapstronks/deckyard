/**
 * Public API v1 - Presentations endpoints.
 * Handles CRUD operations for presentations via API key authentication.
 */

import {
  listPresentations,
  getPresentation,
  createPresentation,
  updatePresentation,
  deletePresentation,
  duplicatePresentation,
} from '../../../storage/presentations.js';
import { getTagsForPresentations, getTagsForPresentation } from '../../../storage/tags.js';
import { methodNotAllowed, badRequest } from '../../../utils/http.js';
import { normalizeEmail } from '../../../utils/normalize.js';
import { requireScope, canAccessPresentation, getPresentationWithAccess, parseJsonBody, parsePaginationParams, apiSuccess, apiCreated, apiError } from './middleware.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Filter presentations to only those accessible to the API key owner.
 */
function filterByOwner(presentations, ownerEmail) {
  return presentations.filter((p) => canAccessPresentation(p, ownerEmail));
}

/**
 * Strip internal fields from presentation for API response.
 */
function sanitizePresentation(pres, tags = []) {
  if (!pres) return null;

  return {
    id: pres.id,
    title: pres.title,
    description: pres.description || null,
    ownerEmail: pres.ownerEmail || null,
    scope: pres.scope || 'private',
    themeId: pres.themeId || null,
    language: pres.language || 'en-GB',
    slideCount: Array.isArray(pres.slides) ? pres.slides.length : 0,
    slides: pres.slides || [],
    i18n: pres.i18n || null,
    revision: pres.revision || 0,
    createdAt: pres.createdAt || null,
    updatedAt: pres.updatedAt || null,
    tags,
  };
}

/**
 * Strip slides for list view (summary only).
 */
function sanitizeForList(pres, tags = []) {
  const sanitized = sanitizePresentation(pres, tags);
  if (!sanitized) return null;

  // Remove full slide content for list view, keep only summary
  const { slides, i18n, ...summary } = sanitized;
  return summary;
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/presentations - List presentations.
 *
 * Query parameters:
 * - limit: max results per page (default 50, max 100)
 * - offset: pagination offset (default 0)
 * - viewOnly: if 'true', only return view-only presentations
 */
async function handleList(ctx) {
  const { repoRoot, res, apiKey, url } = ctx;

  if (!requireScope(ctx, 'read')) return true;

  const list = await listPresentations(repoRoot);
  let filtered = filterByOwner(list, apiKey.ownerEmail);

  // Optional filters
  const viewOnlyFilter = url.searchParams.get('viewOnly');

  if (viewOnlyFilter === 'true') {
    filtered = filtered.filter((p) => p?.isViewOnly === true);
  }

  const { limit, offset } = parsePaginationParams(url);

  // Apply pagination
  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  // Fetch tags for all presentations
  const presentationIds = paginated.map((p) => p.id);
  const tagsMap = await getTagsForPresentations(presentationIds);

  // Build response
  const presentations = paginated.map((p) =>
    sanitizeForList(p, tagsMap.get(p.id) || [])
  );

  await apiSuccess(ctx, {
    presentations,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
  return true;
}

/**
 * POST /api/v1/presentations - Create a new presentation.
 */
async function handleCreate(ctx) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, ctx.req);
  if (!bodyOk) return true;

  if (!body || typeof body !== 'object') {
    await apiError(ctx, 400, 'Request body must be a JSON object');
    return true;
  }

  // Create presentation with API key owner as the owner
  const created = await createPresentation(repoRoot, {
    ...body,
    ownerEmail: apiKey.ownerEmail,
  });

  const tags = await getTagsForPresentation(created.id);
  await apiCreated(ctx, {
    presentation: sanitizePresentation(created, tags),
  });
  return true;
}

/**
 * GET /api/v1/presentations/:id - Get a single presentation.
 */
async function handleGet(ctx, id) {
  if (!requireScope(ctx, 'read')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id);
  if (!ok) return true;

  const tags = await getTagsForPresentation(id);
  await apiSuccess(ctx, {
    presentation: sanitizePresentation(pres, tags),
  });
  return true;
}

/**
 * PUT /api/v1/presentations/:id - Update a presentation.
 */
async function handleUpdate(ctx, id) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok, pres: existing } = await getPresentationWithAccess(ctx, id, { access: 'write' });
  if (!ok) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, ctx.req);
  if (!bodyOk) return true;

  if (!body || typeof body !== 'object') {
    await apiError(ctx, 400, 'Request body must be a JSON object');
    return true;
  }

  // Don't allow changing ownership via API
  delete body.ownerEmail;
  delete body.createdBy;

  let updated;
  try {
    updated = await updatePresentation(repoRoot, id, body, {
      actorEmail: apiKey.ownerEmail,
    });
  } catch (e) {
    if (e?.statusCode) {
      await apiError(ctx, e.statusCode, e.message, { details: e.details || null });
      return true;
    }
    throw e;
  }

  if (!updated) {
    await apiError(ctx, 404, 'Presentation not found');
    return true;
  }

  const tags = await getTagsForPresentation(id);
  await apiSuccess(ctx, {
    presentation: sanitizePresentation(updated, tags),
  });
  return true;
}

/**
 * DELETE /api/v1/presentations/:id - Delete a presentation.
 */
async function handleDelete(ctx, id) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const existing = await getPresentation(repoRoot, id);
  if (!existing) {
    await apiError(ctx, 404, 'Presentation not found');
    return true;
  }

  // Only owner can delete
  const owner = normalizeEmail(existing?.ownerEmail);
  const apiOwner = normalizeEmail(apiKey.ownerEmail);
  if (owner && owner !== apiOwner) {
    await apiError(ctx, 403, 'Only the presentation owner can delete it');
    return true;
  }

  const deleted = await deletePresentation(repoRoot, id, {
    actorEmail: apiKey.ownerEmail,
  });

  if (!deleted) {
    await apiError(ctx, 404, 'Presentation not found');
    return true;
  }

  await apiSuccess(ctx, { deleted: true });
  return true;
}

/**
 * POST /api/v1/presentations/:id/duplicate - Duplicate a presentation.
 */
async function handleDuplicate(ctx, id) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok, pres: existing } = await getPresentationWithAccess(ctx, id);
  if (!ok) return true;

  const duplicated = await duplicatePresentation(repoRoot, id, {
    actorEmail: apiKey.ownerEmail,
  });

  if (!duplicated) {
    await apiError(ctx, 500, 'Failed to duplicate presentation');
    return true;
  }

  const tags = await getTagsForPresentation(duplicated.id);
  await apiCreated(ctx, {
    presentation: sanitizePresentation(duplicated, tags),
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Main handler for /api/v1/presentations routes.
 */
export async function handlePresentations(ctx) {
  const { req, res, url } = ctx;

  // Duplicate endpoint
  const dupMatch = url.pathname.match(/^\/api\/v1\/presentations\/([^/]+)\/duplicate$/);
  if (dupMatch) {
    if (req.method !== 'POST') {
      return methodNotAllowed(res, ['POST']);
    }
    return handleDuplicate(ctx, dupMatch[1]);
  }

  // Single presentation routes
  const presMatch = url.pathname.match(/^\/api\/v1\/presentations\/([^/]+)$/);
  if (presMatch) {
    const id = presMatch[1];
    if (req.method === 'GET') return handleGet(ctx, id);
    if (req.method === 'PUT') return handleUpdate(ctx, id);
    if (req.method === 'DELETE') return handleDelete(ctx, id);
    return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
  }

  // Collection routes
  if (url.pathname === '/api/v1/presentations') {
    if (req.method === 'GET') return handleList(ctx);
    if (req.method === 'POST') return handleCreate(ctx);
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  return false;
}
