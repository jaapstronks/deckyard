/**
 * Authenticated guest management endpoints.
 *
 * POST   /api/presentations/:id/share-links/:linkId/guests             - Pre-register guest
 * GET    /api/presentations/:id/share-links/:linkId/guests             - List guests
 * DELETE /api/presentations/:id/share-links/:linkId/guests/:guestId    - Remove guest
 * POST   /api/presentations/:id/share-links/:linkId/guests/:guestId/resend - Resend invitation
 */

import { getPresentation } from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import {
  listShareLinks,
  preRegisterGuest,
  listGuestsForShareLink,
  removeGuest,
  markInvitationSent,
} from '../../../storage/share-links.js';
import { sendGuestInvitationEmail } from '../../../integrations/brevo.js';
import { canWritePresentation } from '../../../utils/presentation-authz.js';
import { createRouteContext } from '../../../utils/context.js';
import { serveJson, notFound, unauthorized, badRequest, requireJsonBody, jsonError } from '../../../utils/http.js';
import { buildShareUrl } from '../../../utils/request-url.js';
import { createLogger } from '../../../utils/logger.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';
const log = createLogger('guests');

/**
 * Helper to fetch collaborator permission for ACL checks.
 */
async function getCollabPermission(pres, authedUser, ctx) {
  if (!authedUser?.email || !pres?.id) return null;
  return getCollaboratorPermission(pres.id, authedUser.email, ctx);
}

/**
 * Handle guest management endpoints.
 */
export async function handleGuestManagement({ repoRoot, req, res, url, authedUser }) {
  const ctx = createRouteContext(authedUser);

  // Match /api/presentations/:id/share-links/:linkId/guests
  const guestsMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)\/guests$/
  );

  // POST /api/presentations/:id/share-links/:linkId/guests - Pre-register guest
  if (guestsMatch && req.method === 'POST') {
    const presentationId = guestsMatch[1];
    const linkId = guestsMatch[2];
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    const collaboratorPermission = await getCollabPermission(pres, authedUser, ctx);
    if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) {
      return unauthorized(res);
    }

    const jsonResult = await requireJsonBody(req, res);
    if (!jsonResult.ok) return true;
    const body = jsonResult.body;

    const result = await preRegisterGuest(
      linkId,
      { email: body?.email, name: body?.name },
      authedUser?.email,
      ctx
    );

    if (!result.ok) {
      const statusMap = {
        invalid_email: 400,
        already_invited: 409,
        share_link_not_found: 404,
      };
      const status = statusMap[result.reason] || 400;
      jsonError(res, status, result.reason);
      return true;
    }

    // Send invitation email if requested
    if (body?.sendInvitation !== false) {
      const shareLinks = await listShareLinks(presentationId, {}, ctx);
      const shareLink = shareLinks.find((l) => l.id === linkId);
      if (shareLink) {
        const baseShareUrl = buildShareUrl(req, shareLink.token);
        // Include recipient email in URL for login pre-fill
        const shareUrl = baseShareUrl
          ? `${baseShareUrl}${baseShareUrl.includes('?') ? '&' : '?'}email=${encodeURIComponent(result.guest.email)}`
          : null;
        if (shareUrl) {
          fireAndForget(
            sendGuestInvitationEmail({
              recipientEmail: result.guest.email,
              recipientName: result.guest.name || null,
              presentationTitle: pres.title || 'Presentation',
              shareUrl,
              inviterName: authedUser?.name || authedUser?.email,
              repoRoot,
            }).then((emailResult) => {
              if (emailResult.ok) {
                markInvitationSent(result.guest.id, ctx);
              } else {
                // eslint-disable-next-line no-console
                log.warn(
                  `[brevo] guest invitation email failed to=${result.guest.email} error=${emailResult.error || ''}`.trim()
                );
              }
            }),
            `guest invitation email to=${result.guest.email}`
          );
        }
      }
    }

    serveJson(res, 201, { guest: result.guest, isNew: result.isNew });
    return true;
  }

  // GET /api/presentations/:id/share-links/:linkId/guests - List guests
  if (guestsMatch && req.method === 'GET') {
    const presentationId = guestsMatch[1];
    const linkId = guestsMatch[2];
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    const collaboratorPermission = await getCollabPermission(pres, authedUser, ctx);
    if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) {
      return unauthorized(res);
    }

    const guests = await listGuestsForShareLink(linkId, ctx);
    serveJson(res, 200, { guests });
    return true;
  }

  // Match /api/presentations/:id/share-links/:linkId/guests/:guestId
  const guestMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)\/guests\/([^/]+)$/
  );

  // DELETE /api/presentations/:id/share-links/:linkId/guests/:guestId - Remove guest
  if (guestMatch && req.method === 'DELETE') {
    const presentationId = guestMatch[1];
    const guestId = guestMatch[3];
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    const collaboratorPermission = await getCollabPermission(pres, authedUser, ctx);
    if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) {
      return unauthorized(res);
    }

    const result = await removeGuest(guestId, ctx);
    if (!result.ok) {
      return badRequest(res, result.reason);
    }

    serveJson(res, 200, { ok: true, deleted: result.deleted });
    return true;
  }

  // Match /api/presentations/:id/share-links/:linkId/guests/:guestId/resend
  const resendMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)\/guests\/([^/]+)\/resend$/
  );

  // POST - Resend invitation
  if (resendMatch && req.method === 'POST') {
    const presentationId = resendMatch[1];
    const linkId = resendMatch[2];
    const guestId = resendMatch[3];
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    const collaboratorPermission = await getCollabPermission(pres, authedUser, ctx);
    if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) {
      return unauthorized(res);
    }

    // Get the guest
    const guests = await listGuestsForShareLink(linkId, ctx);
    const guest = guests.find((g) => g.id === guestId);
    if (!guest) {
      return notFound(res);
    }

    // Get the share link
    const shareLinks = await listShareLinks(presentationId, {}, ctx);
    const shareLink = shareLinks.find((l) => l.id === linkId);
    if (!shareLink) {
      return notFound(res);
    }

    const baseShareUrl = buildShareUrl(req, shareLink.token);
    if (!baseShareUrl) {
      return badRequest(res, 'Invalid host header');
    }
    // Include recipient email in URL for login pre-fill
    const shareUrl = `${baseShareUrl}${baseShareUrl.includes('?') ? '&' : '?'}email=${encodeURIComponent(guest.email)}`;

    const emailResult = await sendGuestInvitationEmail({
      recipientEmail: guest.email,
      recipientName: guest.name || null,
      presentationTitle: pres.title || 'Presentation',
      shareUrl,
      inviterName: authedUser?.name || authedUser?.email,
      repoRoot,
    });

    if (emailResult.ok) {
      await markInvitationSent(guestId, ctx);
      serveJson(res, 200, { ok: true, message: 'Invitation resent' });
    } else {
      jsonError(res, 500, 'email_failed');
    }
    return true;
  }

  return false;
}