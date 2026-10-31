/**
 * Public API v1 - Publishing endpoints.
 *
 * Publishing makes an immutable edition (`services/publish-edition.js`, the
 * same service as the internal route); unpublishing revokes every public
 * edition of the deck's series.
 */

import {
  assertPublishingEnabled,
  getDeckPublication,
  publishEdition,
  unpublishPresentation,
} from '../../../services/publish-edition.js';
import { getRequestOrigin } from '../../../utils/request-url.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  getPresentationWithAccess,
  readApiV1Body,
  apiCreated,
  apiSuccess,
} from './middleware.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * POST /api/v1/presentations/:id/publish - Publish the deck as its next
 * edition. A retry with the same `idempotencyKey` answers 200 with the edition
 * the first attempt made.
 */
async function handlePublish(ctx, id) {
  const { storageScope, req, authedUser } = ctx;

  // Refuse in sandbox before reading anything (the shared policy gate). A
  // thrown ForbiddenError renders in the v1 envelope via withV1ErrorHandler.
  assertPublishingEnabled();

  if (!requirePermission(ctx, 'write')) return true;

  const parsed = await readApiV1Body(ctx, req, { requireObject: true });
  if (!parsed.ok) return true;
  const { expectedRevision, idempotencyKey } = parsed.body;

  const result = await publishEdition(
    storageScope,
    { actor: authedUser },
    { presentationId: id, expectedRevision, idempotencyKey },
    { origin: getRequestOrigin(req) },
  );
  await (result.replayed ? apiSuccess : apiCreated)(ctx, {
    replayed: result.replayed,
    edition: {
      publicationId: result.edition.publicationId,
      version: result.edition.version,
      path: result.edition.path,
      manifestHash: result.edition.manifestHash,
      publishedAt: result.edition.publishedAt,
    },
  });
  return true;
}

/**
 * GET /api/v1/presentations/:id/publish - The deck's newest public edition.
 */
async function handleGetPublishStatus(ctx, id) {
  if (!requirePermission(ctx, 'read')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id);
  if (!ok) return true;

  const published = await getDeckPublication(ctx.storageScope, pres);
  await apiSuccess(
    ctx,
    published ? { isPublished: true, ...published } : { isPublished: false },
  );
  return true;
}

/**
 * DELETE /api/v1/presentations/:id/publish - Revoke every public edition.
 */
async function handleUnpublish(ctx, id) {
  if (!requirePermission(ctx, 'write')) return true;

  // The flow is `services/publish-edition.js`; a refusal is thrown and
  // `withV1ErrorHandler` renders it.
  const { revoked } = await unpublishPresentation(
    ctx.storageScope,
    { actor: ctx.authedUser },
    id,
  );

  await apiSuccess(ctx, { unpublished: true, revoked });
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
