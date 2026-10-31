import {
  serveJson,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import { getRequestOrigin } from '../../utils/request-url.js';
import {
  assertPublishingEnabled,
  publishEdition,
  unpublishPresentation,
} from '../../services/publish-edition.js';
import { dispatchRoutes } from '../../utils/router.js';

// POST /api/presentations/:id/publish — publish the deck as its next edition
async function handlePublishCreate({ storageScope, req, res, authedUser }, id) {
  // Refuse in sandbox before reading anything (the shared policy gate).
  assertPublishingEnabled();

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const { expectedRevision, idempotencyKey } = parsed.body;

  // The one publish service, shared with v1 (`services/publish-edition.js`):
  // authorization, gates, sealing, commit and webhook. A refusal is thrown and
  // `withErrorHandler` renders it.
  const result = await publishEdition(
    storageScope,
    { actor: authedUser },
    { presentationId: id, expectedRevision, idempotencyKey },
    { origin: getRequestOrigin(req) },
  );
  serveJson(res, result.replayed ? 200 : 201, result);
  return true;
}

// DELETE /api/presentations/:id/publish — revoke every public edition
async function handlePublishDelete({ storageScope, res, authedUser }, id) {
  const { revoked } = await unpublishPresentation(
    storageScope,
    { actor: authedUser },
    id,
  );
  serveJson(res, 200, { ok: true, revoked });
  return true;
}

/**
 * Declarative route table for publishing: one path, split on method. Method
 * mismatch falls through.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'POST',
    pattern: /^\/api\/presentations\/([^/]+)\/publish$/,
    captures: ['uuid'],
    handler: handlePublishCreate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/presentations\/([^/]+)\/publish$/,
    captures: ['uuid'],
    handler: handlePublishDelete,
  },
];

/**
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handlePublish = withErrorHandler('publish', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
