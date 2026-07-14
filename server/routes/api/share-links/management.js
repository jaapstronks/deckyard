/**
 * Authenticated share link management endpoints.
 *
 * POST   /api/presentations/:id/share-links           - Create share link
 * GET    /api/presentations/:id/share-links           - List share links
 * DELETE /api/presentations/:id/share-links           - Revoke all links
 * DELETE /api/presentations/:id/share-links/:linkId   - Revoke specific link
 * PATCH  /api/presentations/:id/share-links/:linkId   - Update link
 * GET    /api/presentations/:id/share-links/:linkId/access-log - Get access log
 */

import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  revokeAllShareLinks,
  updateShareLink,
  getShareLinkAccessLog,
} from '../../../storage/share-links.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { createRouteContext } from '../../../utils/context.js';
import { serveJson, notFound, badRequest, requireJsonBody, parseJsonBody } from '../../../utils/http.js';
import { validatePermission, parsePaginationParams } from '../../../utils/request-validators.js';
import { buildShareUrl } from '../../../utils/request-url.js';

/**
 * Handle share link management endpoints (CRUD).
 */
export async function handleShareLinkManagement({ repoRoot, req, res, url, authedUser }) {
  const ctx = createRouteContext(authedUser);

  // Match /api/presentations/:id/share-links
  const baseMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/share-links$/
  );

  // POST /api/presentations/:id/share-links - Create share link
  if (baseMatch && req.method === 'POST') {
    const presentationId = baseMatch[1];
    const pres = await withPresentationAuth({ repoRoot, id: presentationId, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const jsonResult = await requireJsonBody(req, res);
    if (!jsonResult.ok) return true;
    const body = jsonResult.body;

    const permission = body?.permission;
    if (!validatePermission(permission, res)) return true;

    const result = await createShareLink(
      presentationId,
      {
        permission,
        label: body?.label,
        password: body?.password,
        expiresAt: body?.expiresAt,
        maxUses: body?.maxUses,
        createdBy: authedUser?.email,
        registrationMode: body?.registrationMode || 'invite_only',
      },
      ctx
    );

    if (!result.ok) {
      return badRequest(res, result.reason);
    }

    const shareUrl = buildShareUrl(req, result.shareLink.token);
    if (!shareUrl) {
      return badRequest(res, 'Invalid host header');
    }

    serveJson(res, 201, {
      ...result.shareLink,
      url: shareUrl,
    });
    return true;
  }

  // GET /api/presentations/:id/share-links - List share links
  if (baseMatch && req.method === 'GET') {
    const presentationId = baseMatch[1];
    const pres = await withPresentationAuth({ repoRoot, id: presentationId, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const includeRevoked = url.searchParams.get('includeRevoked') === 'true';
    const links = await listShareLinks(presentationId, { includeRevoked }, ctx);

    // Add URLs to each link
    const linksWithUrls = links.map((link) => {
      const shareUrl = buildShareUrl(req, link.token);
      return {
        ...link,
        url: shareUrl || '',
      };
    });

    serveJson(res, 200, { shareLinks: linksWithUrls });
    return true;
  }

  // DELETE /api/presentations/:id/share-links - Revoke all share links
  if (baseMatch && req.method === 'DELETE') {
    const presentationId = baseMatch[1];
    const pres = await withPresentationAuth({ repoRoot, id: presentationId, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const result = await revokeAllShareLinks(presentationId, authedUser?.email, ctx);
    if (!result.ok) {
      return badRequest(res, result.reason);
    }

    serveJson(res, 200, { ok: true, count: result.count });
    return true;
  }

  // Match /api/presentations/:id/share-links/:linkId
  const linkMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)$/
  );

  // DELETE /api/presentations/:id/share-links/:linkId - Revoke specific link
  if (linkMatch && req.method === 'DELETE') {
    const presentationId = linkMatch[1];
    const linkId = linkMatch[2];
    const pres = await withPresentationAuth({ repoRoot, id: presentationId, authedUser, res, permission: 'write' });
    if (!pres) return true;

    // Parse optional message from request body
    const { body } = await parseJsonBody(req);
    const message = body?.message || null;

    const result = await revokeShareLink(linkId, authedUser?.email, { message }, ctx);
    if (!result.ok) {
      if (result.reason === 'not_found') return notFound(res);
      return badRequest(res, result.reason);
    }

    serveJson(res, 200, { ok: true });
    return true;
  }

  // PATCH /api/presentations/:id/share-links/:linkId - Update link
  if (linkMatch && req.method === 'PATCH') {
    const presentationId = linkMatch[1];
    const linkId = linkMatch[2];
    const pres = await withPresentationAuth({ repoRoot, id: presentationId, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const jsonResult = await requireJsonBody(req, res);
    if (!jsonResult.ok) return true;
    const body = jsonResult.body;

    const result = await updateShareLink(
      linkId,
      {
        label: body?.label,
        expiresAt: body?.expiresAt,
        maxUses: body?.maxUses,
      },
      ctx
    );

    if (!result.ok) {
      if (result.reason === 'not_found') return notFound(res);
      return badRequest(res, result.reason);
    }

    serveJson(res, 200, result.shareLink);
    return true;
  }

  // GET /api/presentations/:id/share-links/:linkId/access-log - Get access log
  const accessLogMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)\/access-log$/
  );
  if (accessLogMatch && req.method === 'GET') {
    const presentationId = accessLogMatch[1];
    const linkId = accessLogMatch[2];
    const pres = await withPresentationAuth({ repoRoot, id: presentationId, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const { limit, offset } = parsePaginationParams(url.searchParams, { defaultLimit: 100 });
    const log = await getShareLinkAccessLog(linkId, { limit, offset }, ctx);

    serveJson(res, 200, { accessLog: log });
    return true;
  }

  return false;
}