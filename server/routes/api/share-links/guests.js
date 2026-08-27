/**
 * Authenticated guest management endpoints (A7.19 C8 — ROUTES table).
 *
 * POST   /api/presentations/:id/share-links/:linkId/guests             - Pre-register guest
 * GET    /api/presentations/:id/share-links/:linkId/guests             - List guests
 * DELETE /api/presentations/:id/share-links/:linkId/guests/:guestId    - Remove guest
 * POST   /api/presentations/:id/share-links/:linkId/guests/:guestId/resend - Resend invitation
 *
 * Form A throughout (route-dispatch.md): the old chain fell through on a
 * method mismatch, no 405. Table order mirrors the old branch order exactly.
 */

import { getPresentation } from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import {
  listShareLinks,
  preRegisterGuest,
  listGuestsForShareLink,
  removeGuest,
  markInvitationSent,
} from '../../../storage/share-links/index.js';
import { sendGuestInvitationEmail } from '../../../integrations/brevo.js';
import { canWritePresentation } from '../../../utils/presentation-authz/index.js';
import { dispatchRoutes } from '../../../utils/router.js';
import {
  badRequest,
  jsonError,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  forbidden,
} from '../../../utils/http.js';
import { buildShareUrl } from '../../../utils/request-url.js';
import { createLogger } from '../../../utils/logger.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';
const log = createLogger('guests');

/**
 * Helper to fetch collaborator permission for ACL checks.
 *
 * Takes no context: a collaborator row is scoped by its deck, not by the
 * session (see the header of server/storage/collaborators.js).
 */
async function getCollabPermission(pres, authedUser) {
  if (!authedUser?.email || !pres?.id) return null;
  return getCollaboratorPermission(pres.id, authedUser.email);
}

/** POST /api/presentations/:id/share-links/:linkId/guests - Pre-register guest */
async function handleGuestPreRegister(
  { repoRoot, storageScope, req, res, authedUser },
  presentationId,
  linkId,
) {
  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);
  const collaboratorPermission = await getCollabPermission(pres, authedUser);
  if (
    !canWritePresentation({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  const result = await preRegisterGuest(
    storageScope,
    linkId,
    { email: body?.email, name: body?.name },
    authedUser?.email,
  );

  if (!result.ok) {
    storageError(res, result);
    return true;
  }

  // Send invitation email if requested
  if (body?.sendInvitation !== false) {
    const shareLinks = await listShareLinks(storageScope, presentationId, {});
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
              markInvitationSent(storageScope, result.guest.id);
            } else {
              // eslint-disable-next-line no-console
              log.warn(
                `[brevo] guest invitation email failed to=${result.guest.email} error=${emailResult.error || ''}`.trim(),
              );
            }
          }),
          `guest invitation email to=${result.guest.email}`,
        );
      }
    }
  }

  serveJson(res, 201, { guest: result.guest, isNew: result.isNew });
  return true;
}

/** GET /api/presentations/:id/share-links/:linkId/guests - List guests */
async function handleGuestList(
  { storageScope, res, authedUser },
  presentationId,
  linkId,
) {
  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);
  const collaboratorPermission = await getCollabPermission(pres, authedUser);
  if (
    !canWritePresentation({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  const guests = await listGuestsForShareLink(storageScope, linkId);
  serveJson(res, 200, { guests });
  return true;
}

/** DELETE /api/presentations/:id/share-links/:linkId/guests/:guestId - Remove guest */
async function handleGuestRemove(
  { storageScope, res, authedUser },
  presentationId,
  _linkId,
  guestId,
) {
  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);
  const collaboratorPermission = await getCollabPermission(pres, authedUser);
  if (
    !canWritePresentation({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  const result = await removeGuest(storageScope, guestId);
  if (!result.ok) {
    return storageError(res, result);
  }

  serveJson(res, 200, { ok: true, deleted: result.deleted });
  return true;
}

/** POST /api/presentations/:id/share-links/:linkId/guests/:guestId/resend - Resend invitation */
async function handleGuestResend(
  { repoRoot, storageScope, req, res, authedUser },
  presentationId,
  linkId,
  guestId,
) {
  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);
  const collaboratorPermission = await getCollabPermission(pres, authedUser);
  if (
    !canWritePresentation({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  // Get the guest
  const guests = await listGuestsForShareLink(storageScope, linkId);
  const guest = guests.find((g) => g.id === guestId);
  if (!guest) {
    return notFound(res);
  }

  // Get the share link
  const shareLinks = await listShareLinks(storageScope, presentationId, {});
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
    await markInvitationSent(storageScope, guestId);
    serveJson(res, 200, { ok: true, message: 'Invitation resent' });
  } else {
    jsonError(res, 500, 'email_failed');
  }
  return true;
}

const GUESTS_PATTERN =
  /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)\/guests$/;
const GUEST_PATTERN =
  /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)\/guests\/([^/]+)$/;
const RESEND_PATTERN =
  /^\/api\/presentations\/([^/]+)\/share-links\/([^/]+)\/guests\/([^/]+)\/resend$/;

/**
 * Guest routes in the old chain's exact order: the two collection branches,
 * then the :guestId delete, then the resend action.
 * @type {import('../../../utils/router.js').Route[]}
 */
export const GUEST_ROUTES = [
  { method: 'POST', pattern: GUESTS_PATTERN, handler: handleGuestPreRegister },
  { method: 'GET', pattern: GUESTS_PATTERN, handler: handleGuestList },
  { method: 'DELETE', pattern: GUEST_PATTERN, handler: handleGuestRemove },
  { method: 'POST', pattern: RESEND_PATTERN, handler: handleGuestResend },
];

/**
 * Handle guest management endpoints.
 * @param {import('../../../utils/context.js').AuthedContext} ctx
 */
export async function handleGuestManagement(ctx) {
  return dispatchRoutes(GUEST_ROUTES, ctx);
}
