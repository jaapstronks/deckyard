/**
 * Authenticated share link management endpoints (A7.19 C8 — ROUTES table).
 *
 * POST   /api/presentations/:id/share-links           - Create share link
 * GET    /api/presentations/:id/share-links           - List share links
 * DELETE /api/presentations/:id/share-links           - Revoke all links
 * DELETE /api/presentations/:id/share-links/:linkId   - Revoke specific link
 * PATCH  /api/presentations/:id/share-links/:linkId   - Update link
 * GET    /api/presentations/:id/share-links/:linkId/access-log - Get access log
 *
 * Form A throughout (route-dispatch.md): the old chain fell through on a
 * method mismatch, no 405. Table order mirrors the old branch order exactly.
 */

import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  revokeAllShareLinks,
  updateShareLink,
  getShareLinkAccessLog,
  getShareLinkById,
} from '../../../storage/share-links/index.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { dispatchRoutes } from '../../../utils/router.js';
import {
  badRequest,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
} from '../../../utils/http.js';
import {
  validatePermission,
  parsePaginationParams,
} from '../../../utils/request-validators.js';
import { buildShareUrl } from '../../../utils/request-url.js';

/**
 * Whether a loaded share link belongs to the given presentation. Fail-closed:
 * a null/unknown link or a mismatching presentationId returns false.
 * @param {Object|null} link - Formatted share link (has `presentationId`)
 * @param {string} presentationId - The presentation the caller is authorized for
 * @returns {boolean}
 */
export function shareLinkBelongsToPresentation(link, presentationId) {
  return !!link && !!presentationId && link.presentationId === presentationId;
}

/**
 * Load a share link and assert it belongs to the presentation the caller is
 * already authorized to write. Prevents a linkId-based IDOR: withPresentationAuth
 * only proves write on `presentationId`, not that `linkId` belongs to that deck,
 * so a forged linkId from another (private) deck could otherwise be
 * revoked/relabeled or have its viewer-PII access log read.
 *
 * @returns {Promise<Object|null>} the share link if it belongs to the
 *   presentation, or null after sending a 404 (mismatch or unknown link).
 */
async function loadLinkForPresentation({
  linkId,
  presentationId,
  res,
  storageScope,
}) {
  const link = await getShareLinkById(storageScope, linkId);
  if (!shareLinkBelongsToPresentation(link, presentationId)) {
    notFound(res);
    return null;
  }
  return link;
}

/** POST /api/presentations/:id/share-links - Create share link */
async function handleShareLinkCreate(
  { storageScope, req, res, authedUser },
  presentationId,
) {
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  const permission = body?.permission;
  if (!validatePermission(permission, res)) return true;

  const result = await createShareLink(storageScope, presentationId, {
    permission,
    label: body?.label,
    password: body?.password,
    expiresAt: body?.expiresAt,
    maxUses: body?.maxUses,
    createdBy: authedUser?.email,
    registrationMode: body?.registrationMode || 'invite_only',
  });

  if (!result.ok) {
    return storageError(res, result);
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

/** GET /api/presentations/:id/share-links - List share links */
async function handleShareLinkList(
  { storageScope, req, res, url, authedUser },
  presentationId,
) {
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const includeRevoked = url.searchParams.get('includeRevoked') === 'true';
  const links = await listShareLinks(storageScope, presentationId, {
    includeRevoked,
  });

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

/** DELETE /api/presentations/:id/share-links - Revoke all share links */
async function handleShareLinksRevokeAll(
  { storageScope, res, authedUser },
  presentationId,
) {
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const result = await revokeAllShareLinks(
    storageScope,
    presentationId,
    authedUser?.email,
  );
  if (!result.ok) {
    return storageError(res, result);
  }

  serveJson(res, 200, { ok: true, count: result.count });
  return true;
}

/** DELETE /api/presentations/:id/share-links/:linkId - Revoke specific link */
async function handleShareLinkRevoke(
  { storageScope, req, res, authedUser },
  presentationId,
  linkId,
) {
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  // Bind linkId to the authorized presentation (prevents cross-deck IDOR).
  const link = await loadLinkForPresentation({
    linkId,
    presentationId,
    res,
    storageScope,
  });
  if (!link) return true;

  // Parse optional message from request body
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const message = parsed.body?.message || null;

  const result = await revokeShareLink(
    storageScope,
    linkId,
    authedUser?.email,
    { message },
  );
  if (!result.ok) {
    return storageError(res, result);
  }

  serveJson(res, 200, { ok: true });
  return true;
}

/** PATCH /api/presentations/:id/share-links/:linkId - Update link */
async function handleShareLinkUpdate(
  { storageScope, req, res, authedUser },
  presentationId,
  linkId,
) {
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  // Bind linkId to the authorized presentation (prevents cross-deck IDOR).
  const link = await loadLinkForPresentation({
    linkId,
    presentationId,
    res,
    storageScope,
  });
  if (!link) return true;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  const result = await updateShareLink(storageScope, linkId, {
    label: body?.label,
    expiresAt: body?.expiresAt,
    maxUses: body?.maxUses,
  });

  if (!result.ok) {
    return storageError(res, result);
  }

  serveJson(res, 200, result.shareLink);
  return true;
}

/** GET /api/presentations/:id/share-links/:linkId/access-log - Get access log */
async function handleShareLinkAccessLog(
  { storageScope, res, url, authedUser },
  presentationId,
  linkId,
) {
  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  // Bind linkId to the authorized presentation before reading viewer PII
  // (IP/UA access log) — prevents cross-deck IDOR.
  const link = await loadLinkForPresentation({
    linkId,
    presentationId,
    res,
    storageScope,
  });
  if (!link) return true;

  const { limit, offset } = parsePaginationParams(url.searchParams, {
    defaultLimit: 100,
  });
  const log = await getShareLinkAccessLog(linkId, { limit, offset });

  serveJson(res, 200, { accessLog: log });
  return true;
}

const BASE_PATTERN = /^\/api\/presentations\/([^/]+)\/share-links$/;
const LINK_PATTERN = /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)$/;
const ACCESS_LOG_PATTERN =
  /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)\/access-log$/;

/**
 * Management routes in the old chain's exact order: the three base-path
 * branches, then the two :linkId branches, then the access log.
 * @type {import('../../../utils/router.js').Route[]}
 */
export const MANAGEMENT_ROUTES = [
  { method: 'POST', pattern: BASE_PATTERN, handler: handleShareLinkCreate },
  { method: 'GET', pattern: BASE_PATTERN, handler: handleShareLinkList },
  {
    method: 'DELETE',
    pattern: BASE_PATTERN,
    handler: handleShareLinksRevokeAll,
  },
  { method: 'DELETE', pattern: LINK_PATTERN, handler: handleShareLinkRevoke },
  { method: 'PATCH', pattern: LINK_PATTERN, handler: handleShareLinkUpdate },
  {
    method: 'GET',
    pattern: ACCESS_LOG_PATTERN,
    handler: handleShareLinkAccessLog,
  },
];

/**
 * Handle share link management endpoints (CRUD).
 * @param {import('../../../utils/context.js').AuthedContext} ctx
 */
export async function handleShareLinkManagement(ctx) {
  return dispatchRoutes(MANAGEMENT_ROUTES, ctx);
}
