/**
 * Public API v1 - Publishing endpoints.
 * Handles publish/unpublish operations for presentations.
 */

import {
  removePublishedEntry,
} from '../../../storage/published/index.js';
import { updatePresentation } from '../../../storage/presentations/index.js';
import { publishPresentation, assertPublishingEnabled } from '../../../services/publish-presentation.js';
import { requirePermission, v1MethodNotAllowed, withV1ErrorHandler, getPresentationWithAccess, apiSuccess } from './middleware.js';

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

  const { ok, pres } = await getPresentationWithAccess(ctx, id, { access: 'write' });
  if (!ok) return true;

  // The publish flow (sandbox refusal, OG preview, entry upsert, thumbnail
  // warm, webhook) is shared with the internal route — one canonical form. A
  // sandbox refusal surfaces as a thrown ForbiddenError; withV1ErrorHandler
  // renders it in the v1 envelope.
  const result = await publishPresentation({ repoRoot, storageScope, req, pres, actor: authedUser });
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
  const { storageScope, apiKey } = ctx;

  if (!requirePermission(ctx, 'write')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id, { access: 'write' });
  if (!ok) return true;

  const publishId = String(pres?.published?.id || '').trim();
  if (publishId) {
    await removePublishedEntry(storageScope, publishId);
  }

  // Explicit null, not a deleted key: the storage layer reads an absent key
  // as "leave this column alone", so dropping it would keep the deck published
  // in the database.
  const nextPres = { ...pres, published: null };
  await updatePresentation(storageScope, id, nextPres, {
    actorEmail: apiKey.ownerEmail,
  });

  await apiSuccess(ctx, { unpublished: true });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Main handler for /api/v1/presentations/:id/publish routes.
 */
export const handlePublishing = withV1ErrorHandler('public-api-v1:publishing', async (ctx) => {
  const { req, res, url } = ctx;

  const publishMatch = url.pathname.match(
    /^\/api\/v1\/presentations\/([^/]+)\/publish$/
  );
  if (!publishMatch) {
    return false;
  }

  const id = publishMatch[1];

  if (req.method === 'POST') return handlePublish(ctx, id);
  if (req.method === 'GET') return handleGetPublishStatus(ctx, id);
  if (req.method === 'DELETE') return handleUnpublish(ctx, id);

  return v1MethodNotAllowed(res, ['GET', 'POST', 'DELETE']);
});
