/**
 * Public API v1 - Presentations endpoints.
 * Handles CRUD operations for presentations via API key authentication.
 */

import {
  getTagsForPresentations,
  getTagsForPresentation,
} from '../../../storage/tags.js';
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
} from './middleware.js';
import {
  parsePaginationParams,
  parseQueryFlag,
} from '../../../utils/request-validators.js';
import { savePresentation } from '../../../services/save-presentation.js';
import {
  createPresentation,
  deletePresentation,
  duplicatePresentation,
  listPresentationsForActor,
  publicDeckTimestamps,
} from '../../../services/presentations.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Strip internal fields from presentation for API response.
 * @param {object} pres
 * @param {Array<{id: string, name: string}>} [tags]
 * @param {string|null} [requesterEmail] - the API-key owner; the owner email is
 *   only returned to the owner themselves, redacted otherwise.
 */
export function sanitizePresentation(pres, tags = [], requesterEmail = null) {
  if (!pres) return null;

  const owner = pres.ownerEmail || null;
  // Only expose the owner's raw email to the owner themselves; redact it for
  // decks reached via organization/collaborator access so one user's address never
  // leaks to another. This stays a *display* decision: the identity a consumer
  // compares is `ownerId`, which is not redacted because it discloses nothing
  // about a person — see shared/identity-match.js and docs/openapi.yaml.
  const ownerEmail =
    requesterEmail &&
    owner &&
    owner.toLowerCase() === String(requesterEmail).toLowerCase()
      ? owner
      : null;

  return {
    id: pres.id,
    title: pres.title,
    description: pres.description || null,
    // Identity as an (id, email) pair: the id is the key, the email display.
    ownerId: pres.ownerId || null,
    // The creator and last writer reach this layer as display pairs (D22);
    // v1 publishes ids only, so the id is projected out of each.
    createdById: pres.createdBy?.id || null,
    updatedById: pres.updatedBy?.id || null,
    ownerEmail,
    visibility: pres.visibility || 'private',
    // A view-only organization deck is comment-only for everyone but its
    // owner. Exposed so the documented `?viewOnly=true` list filter reads a
    // property a consumer can also see in the payload (B62 vondst 12).
    isViewOnly: !!pres.isViewOnly,
    // The stored names, published as-is: one name per field on every surface
    // (B446). These read `themeId`/`language`, which no deck carries, so every
    // deck answered `null` and `en-GB` whatever it was.
    theme: pres.theme || null,
    lang: pres.lang || null,
    slideCount: Array.isArray(pres.slides) ? pres.slides.length : 0,
    // Project each stored bare registry key to its one published spelling (the
    // canonical id). Storage keeps the key; nothing non-canonical crosses the
    // API boundary. Spread so we never mutate the stored slide.
    slides: (pres.slides || []).map((s) => ({
      ...s,
      type: canonicalSlideType(s?.type),
    })),
    i18n: pres.i18n || null,
    revision: pres.revision || 0,
    ...publicDeckTimestamps(pres),
    tags,
  };
}

/**
 * Strip slides for list view (summary only).
 */
function sanitizeForList(pres, tags = [], requesterEmail = null) {
  const sanitized = sanitizePresentation(pres, tags, requesterEmail);
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
 * - viewOnly: 'true' only view-only presentations, 'false' only the others;
 *   any other value is 400 `invalid` (`details.field: 'viewOnly'`)
 */
async function handleList(ctx) {
  const { storageScope, apiKey, authedUser, url } = ctx;

  if (!requirePermission(ctx, 'read')) return true;

  // The page size keeps its documented clamp (default 50, max 100); who sees
  // what and the viewOnly filter are the service's (B607).
  const { limit, offset } = parsePaginationParams(url.searchParams);
  const { presentations: paginated, total } = await listPresentationsForActor(
    storageScope,
    { actor: authedUser },
    { viewOnly: parseQueryFlag(url.searchParams, 'viewOnly'), limit, offset },
  );

  // Fetch tags for all presentations
  const presentationIds = paginated.map((p) => p.id);
  const tagsMap = await getTagsForPresentations(storageScope, presentationIds);

  // Build response
  const presentations = paginated.map((p) =>
    sanitizeForList(p, tagsMap.get(p.id) || [], apiKey.ownerEmail),
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
  const { storageScope, apiKey } = ctx;

  if (!requirePermission(ctx, 'write')) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, ctx.req, {
    requireObject: true,
  });
  if (!bodyOk) return true;

  // The key owner creates the deck; a refusal is answered in the v1 envelope
  // by the mount-level withV1ErrorHandler wrap.
  const created = await createPresentation(
    storageScope,
    { actor: ctx.authedUser },
    body,
  );

  const tags = await getTagsForPresentation(storageScope, created.id);
  await apiCreated(ctx, {
    presentation: sanitizePresentation(created, tags, apiKey.ownerEmail),
  });
  return true;
}

/**
 * GET /api/v1/presentations/:id - Get a single presentation.
 */
async function handleGet(ctx, id) {
  if (!requirePermission(ctx, 'read')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id);
  if (!ok) return true;

  const tags = await getTagsForPresentation(ctx.storageScope, id);
  await apiSuccess(ctx, {
    presentation: sanitizePresentation(pres, tags, ctx.apiKey?.ownerEmail),
  });
  return true;
}

/**
 * PUT /api/v1/presentations/:id - Update a presentation.
 */
async function handleUpdate(ctx, id) {
  if (!requirePermission(ctx, 'write')) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, ctx.req, {
    requireObject: true,
  });
  if (!bodyOk) return true;

  // Loading, the refusals (owner, creator, lang, retired names), a theme
  // switch and the storage result are the save service's (B608); a refusal
  // is answered in the v1 envelope by the mount-level withV1ErrorHandler wrap.
  const updated = await savePresentation(
    ctx.storageScope,
    { actor: ctx.authedUser },
    { presentationId: id, changes: body },
  );

  const tags = await getTagsForPresentation(ctx.storageScope, id);
  await apiSuccess(ctx, {
    presentation: sanitizePresentation(updated, tags, ctx.apiKey.ownerEmail),
  });
  return true;
}

/**
 * DELETE /api/v1/presentations/:id - Delete a presentation.
 */
async function handleDelete(ctx, id) {
  if (!requirePermission(ctx, 'write')) return true;

  // Only the owner trashes the deck (D22); a refusal is answered in the v1
  // envelope by the mount-level withV1ErrorHandler wrap.
  await deletePresentation(ctx.storageScope, { actor: ctx.authedUser }, id);
  await apiSuccess(ctx, { deleted: true });
  return true;
}

/**
 * POST /api/v1/presentations/:id/duplicate - Duplicate a presentation.
 */
async function handleDuplicate(ctx, id) {
  const { storageScope, apiKey } = ctx;

  if (!requirePermission(ctx, 'write')) return true;

  // The key owner copies the deck; a refusal is answered in the v1 envelope
  // by the mount-level withV1ErrorHandler wrap.
  const copy = await duplicatePresentation(
    storageScope,
    { actor: ctx.authedUser },
    id,
  );

  const tags = await getTagsForPresentation(storageScope, copy.id);
  await apiCreated(ctx, {
    presentation: sanitizePresentation(copy, tags, apiKey.ownerEmail),
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/** Presentation routes; a known path with another method answers 405. */
export const ROUTES = [
  {
    method: 'POST',
    id: 'duplicatePresentation',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/duplicate$/,
    captures: ['uuid'],
    handler: handleDuplicate,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/duplicate$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['POST']),
  },
  {
    method: 'GET',
    id: 'getPresentation',
    pattern: /^\/api\/v1\/presentations\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleGet,
  },
  {
    method: 'PUT',
    id: 'updatePresentation',
    pattern: /^\/api\/v1\/presentations\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleUpdate,
  },
  {
    method: 'DELETE',
    id: 'deletePresentation',
    pattern: /^\/api\/v1\/presentations\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleDelete,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET', 'PUT', 'DELETE']),
  },
  {
    method: 'GET',
    id: 'listPresentations',
    pattern: '/api/v1/presentations',
    handler: handleList,
  },
  {
    method: 'POST',
    id: 'createPresentation',
    pattern: '/api/v1/presentations',
    handler: handleCreate,
  },
  {
    pattern: '/api/v1/presentations',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET', 'POST']),
  },
];

/**
 * Main handler for /api/v1/presentations routes.
 */
export const handlePresentations = withV1ErrorHandler(
  'public-api-v1:presentations',
  (ctx) => dispatchV1Routes(ROUTES, ctx),
);
