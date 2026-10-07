/**
 * Public API v1 - Publishing endpoints.
 * Handles publish/unpublish operations for presentations.
 */

import {
  publishPresentation,
  assertPublishingEnabled,
  unpublishPresentation,
} from '../../../services/publish-presentation.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  getPresentationWithAccess,
  apiSuccess,
} from './middleware.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * POST /api/v1/presentations/:id/publish - Publish a presentation.
 */
async function handlePublish(ctx, id) {
  const { repoRoot, storageScope, req, authedUser } = ctx;

  // Refuse in sandbox before loading the deck (the shared policy gate). A
  // thrown ForbiddenError renders in the v1 envelope via withV1ErrorHandler.
  assertPublishingEnabled();

  if (!requirePermission(ctx, 'write')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id, {
    access: 'write',
  });
  if (!ok) return true;

  // The publish flow (sandbox refusal, OG preview, entry upsert, thumbnail
  // warm, webhook) is shared with the internal route — one canonical form. A
  // sandbox refusal surfaces as a thrown ForbiddenError; withV1ErrorHandler
  // renders it in the v1 envelope.
  const result = await publishPresentation({
    repoRoot,
    storageScope,
    req,
    pres,
    actor: authedUser,
  });
  await apiSuccess(ctx, result);
  return true;
}

/**
 * GET /api/v1/presentations/:id/publish - Get publish status.
 */
async function handleGetPublishStatus(ctx, id) {
  if (!requirePermission(ctx, 'read')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id);
  if (!ok) return true;

  const published = pres?.published;
  if (!published || typeof published.id !== 'string' || !published.id) {
    await apiSuccess(ctx, {
      isPublished: false,
    });
    return true;
  }

  await apiSuccess(ctx, {
    isPublished: true,
    publishId: published.id,
    slug: published.slug || '',
    path: `/p/${published.id}-${published.slug || ''}`,
    ogImageUrl: published.ogImageUrl || '',
    publishedAt: published.created || null,
  });
  return true;
}

/**
 * DELETE /api/v1/presentations/:id/publish - Unpublish a presentation.
 */
async function handleUnpublish(ctx, id) {
  if (!requirePermission(ctx, 'write')) return true;

  // The flow is `services/publish-presentation.js`; a refusal is thrown and
  // `withV1ErrorHandler` renders it.
  await unpublishPresentation(ctx.storageScope, { actor: ctx.authedUser }, id);

  await apiSuccess(ctx, { unpublished: true });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/** Publish, status and unpublish on one path; other methods answer 405. */
export const ROUTES = [
  {
    method: 'POST',
    id: 'publishPresentation',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/publish$/,
    captures: ['uuid'],
    handler: handlePublish,
  },
  {
    method: 'GET',
    id: 'getPublication',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/publish$/,
    captures: ['uuid'],
    handler: handleGetPublishStatus,
  },
  {
    method: 'DELETE',
    id: 'unpublishPresentation',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/publish$/,
    captures: ['uuid'],
    handler: handleUnpublish,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/publish$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET', 'POST', 'DELETE']),
  },
];

/**
 * Main handler for /api/v1/presentations/:id/publish routes.
 */
export const handlePublishing = withV1ErrorHandler(
  'public-api-v1:publishing',
  (ctx) => dispatchV1Routes(ROUTES, ctx),
);
