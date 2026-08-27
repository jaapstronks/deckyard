/**
 * API routes for presentation collaborators.
 *
 * Authenticated endpoints:
 *   POST   /api/presentations/:id/collaborators       - Add collaborator
 *   GET    /api/presentations/:id/collaborators       - List collaborators
 *   DELETE /api/presentations/:id/collaborators/:email - Remove collaborator
 *   PATCH  /api/presentations/:id/collaborators/:email - Update permission
 *   GET    /api/presentations/shared-with-me          - List presentations shared with current user
 */

import {
  getPresentation,
  getFirstSlidesForIds,
} from '../../storage/presentations/index.js';
import {
  addCollaborator,
  listCollaborators,
  removeCollaborator,
  updateCollaboratorPermission,
  listPresentationsSharedWithUser,
  getCollaboratorPermission,
} from '../../storage/collaborators.js';
import { listUsers } from '../../storage/users.js';
import { sendCollaboratorInviteEmail } from '../../integrations/brevo.js';
import { canManageCollaborators } from '../../utils/presentation-authz/index.js';
import { dispatchRoutes } from '../../utils/router.js';
import {
  badRequest,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  unauthorized,
  withErrorHandler,
  forbidden,
} from '../../utils/http.js';
import { validatePermission } from '../../utils/request-validators.js';
import { createNotification } from '../../storage/notifications.js';
import {
  broadcastToUser,
  NotificationEventTypes,
} from '../../services/notification-events.js';
import {
  createActivityEvent,
  EVENT_TYPES,
  ENTITY_TYPES,
} from '../../storage/activity-events.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { createLogger } from '../../utils/logger.js';
import { fireAndForget } from '../../utils/fire-and-forget.js';
const log = createLogger('collaborators');

/**
 * Human-readable text per invite-failure reason, for the single-invite
 * response. A reason without an entry sends no `message`, so the canonical
 * envelope's `error` code carries the meaning on its own — that is what
 * `already_exists` has always done. Adding a message here stays free: clients
 * branch on the code, not on the display text.
 *
 * The status per reason is not here: it comes from the `REASONS` register
 * (`server/storage/reasons.js`) via `getErrorStatus()`, so one reason has one
 * status across every route that answers it.
 */
const INVITE_FAILURE_MESSAGES = {
  user_not_found: 'User not found in organization',
  database_error: 'Failed to add collaborator',
  unavailable: 'Collaborator storage is unavailable',
};

/**
 * Human-readable text per `field` when the reason is `invalid`.
 *
 * D48 collapsed four generic `invalid_*` spellings into one `invalid` carrying
 * a `field`; D52 collapsed the rest, so the copy that used to hang off the
 * suffix hangs off the field name instead. The field also reaches the client as
 * `details.field`, which is more than the suffix gave it.
 */
const INVALID_FIELD_MESSAGES = {
  permission: 'Unsupported permission',
  email: 'Invalid email address',
};

// GET /api/presentations/shared-with-me - List presentations shared with current user
async function handleSharedWithMe({ storageScope, res, authedUser }) {
  if (!authedUser?.email) {
    return unauthorized(res);
  }

  const presentations = await listPresentationsSharedWithUser(
    storageScope,
    authedUser.email,
  );

  // Batch-fetch first slides for all presentations (avoids N+1 queries).
  // The grid only needs the presence signal — the thumbnail is a
  // server-rasterized PNG — so this collapses to a boolean.
  const ids = presentations.map((p) => p.id);
  const firstSlidesMap = await getFirstSlidesForIds(storageScope, ids);

  const presentationsWithSlides = presentations.map((p) => ({
    ...p,
    hasSlides: !!firstSlidesMap.get(p.id),
  }));

  serveJson(res, 200, { presentations: presentationsWithSlides });
  return true;
}

// POST /api/presentations/:id/collaborators - Add collaborator(s)
async function handleCollaboratorAdd(
  { repoRoot, storageScope, req, res, authedUser },
  presentationId,
) {
  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);
  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email,
  );
  if (
    !canManageCollaborators({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  const permission = body?.permission;
  if (!validatePermission(permission, res)) return true;

  // Support both single email and batch emails
  let emailsToInvite = [];
  if (Array.isArray(body?.userEmails) && body.userEmails.length > 0) {
    // Batch mode
    emailsToInvite = body.userEmails
      .map((e) => normalizeEmail(e))
      .filter((e) => e && e.includes('@'));
  } else if (body?.userEmail) {
    // Single mode (backward compatible)
    const singleEmail = normalizeEmail(body.userEmail);
    if (singleEmail && singleEmail.includes('@')) {
      emailsToInvite = [singleEmail];
    }
  }

  if (emailsToInvite.length === 0) {
    return badRequest(res, 'Valid userEmail or userEmails array is required');
  }

  // Limit batch size
  if (emailsToInvite.length > 20) {
    return badRequest(res, 'Maximum 20 users can be invited at once');
  }

  // Prevent adding self as collaborator
  const selfEmail = authedUser?.email?.toLowerCase();
  emailsToInvite = emailsToInvite.filter((e) => e !== selfEmail);
  if (emailsToInvite.length === 0) {
    return badRequest(res, 'Cannot add yourself as a collaborator');
  }

  // Get all users in the organization
  const users = await listUsers(storageScope);
  const userMap = new Map(users.map((u) => [u.email?.toLowerCase(), u]));

  // Process invites
  const results = [];
  const host = req.headers.host || 'localhost';
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const baseEditUrl = `${protocol}://${host}/app/${presentationId}`;
  const presentationTitle = pres.title || 'Untitled presentation';
  const inviterName = authedUser?.name || authedUser?.email;

  for (const userEmail of emailsToInvite) {
    const targetUser = userMap.get(userEmail);
    if (!targetUser) {
      results.push({
        email: userEmail,
        ok: false,
        reason: 'user_not_found',
      });
      continue;
    }

    let result;
    try {
      result = await addCollaborator(presentationId, {
        userEmail,
        permission,
        invitedBy: authedUser?.email,
      });
    } catch (err) {
      log.error(
        `[collaborators] Failed to add collaborator ${userEmail}:`,
        err,
      );
      results.push({
        email: userEmail,
        ok: false,
        reason: 'database_error',
      });
      continue;
    }

    if (!result.ok) {
      results.push({
        email: userEmail,
        ok: false,
        reason: result.reason,
      });
      continue;
    }

    results.push({
      email: userEmail,
      ok: true,
      collaborator: result.collaborator,
      isNew: result.isNew,
      reactivated: result.reactivated || false,
    });

    // Include recipient email in URL for login pre-fill
    const editUrl = `${baseEditUrl}?email=${encodeURIComponent(userEmail)}`;

    // Create in-app notification for the invited user (non-blocking)
    try {
      const notifResult = await createNotification(storageScope, {
        userEmail,
        notificationType: 'share_received',
        title: `${inviterName} shared a presentation with you`,
        body: `You have been invited to "${presentationTitle}" with ${permission} access.`,
        presentationId,
        actorEmail: authedUser?.email,
        actorName: authedUser?.name,
        actionUrl: editUrl,
        data: { permission, presentationTitle },
      });

      // Broadcast notification via SSE
      if (notifResult.ok) {
        broadcastToUser(
          userEmail,
          NotificationEventTypes.NEW,
          notifResult.notification,
        );
      }
    } catch (err) {
      // Log but don't fail the invite if notification fails
      log.error(
        `[collaborators] Failed to create notification for ${userEmail}:`,
        err,
      );
    }

    // Create activity event for the activity feed (non-blocking)
    try {
      await createActivityEvent(storageScope, {
        eventType: EVENT_TYPES.COLLABORATOR_ADDED,
        entityType: ENTITY_TYPES.COLLABORATOR,
        entityId: result.collaborator?.id || presentationId,
        presentationId,
        actorEmail: authedUser?.email,
        actorName: authedUser?.name,
        data: {
          collaboratorEmail: userEmail,
          permission,
          presentationTitle,
        },
      });
    } catch (err) {
      // Log but don't fail the invite if activity event fails
      log.error(
        `[collaborators] Failed to create activity event for ${userEmail}:`,
        err,
      );
    }

    // Send invitation email (non-blocking)
    if (body?.sendInvitation !== false) {
      fireAndForget(
        sendCollaboratorInviteEmail({
          recipientEmail: userEmail,
          recipientName: targetUser.name || null,
          presentationTitle,
          inviterName,
          permission,
          editUrl,
          repoRoot,
        }).then((emailResult) => {
          if (!emailResult.ok) {
            // eslint-disable-next-line no-console
            log.warn(
              `[brevo] collaborator invite email failed to=${userEmail} error=${emailResult.error || ''}`.trim(),
            );
          }
        }),
        `collaborator invite email to=${userEmail}`,
      );
    }
  }

  // Return appropriate response based on single or batch mode
  if (emailsToInvite.length === 1 && !Array.isArray(body?.userEmails)) {
    // Single mode response (backward compatible)
    const singleResult = results[0];
    if (!singleResult.ok) {
      // The reason decides the status. The reasons on this path are a mix
      // of "your request" (`user_not_found`, `invalid`) and "our
      // side" (`database_error`, `unavailable`), and the REASONS register
      // states which is which — no route-local default is involved any more.
      // The batch branch below has always reported the reason factually per
      // address; single mode did not.
      return storageError(
        res,
        singleResult,
        INVALID_FIELD_MESSAGES[singleResult.field] ||
          INVITE_FAILURE_MESSAGES[singleResult.reason],
      );
    }
    serveJson(res, 201, {
      collaborator: singleResult.collaborator,
      isNew: singleResult.isNew,
      reactivated: singleResult.reactivated || false,
    });
  } else {
    // Batch mode response
    const successful = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    serveJson(res, 201, {
      results,
      summary: {
        total: results.length,
        successful: successful.length,
        failed: failed.length,
      },
    });
  }
  return true;
}

// GET /api/presentations/:id/collaborators - List collaborators
async function handleCollaboratorList(
  { storageScope, res, authedUser },
  presentationId,
) {
  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);
  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email,
  );
  if (
    !canManageCollaborators({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  const collaborators = await listCollaborators(presentationId);

  // Enrich with user names if available
  const users = await listUsers(storageScope);
  const userMap = new Map(users.map((u) => [u.email?.toLowerCase(), u]));

  const enrichedCollaborators = collaborators.map((c) => {
    const user = userMap.get(c.userEmail?.toLowerCase());
    return {
      ...c,
      userName: user?.name || null,
    };
  });

  serveJson(res, 200, { collaborators: enrichedCollaborators });
  return true;
}

// DELETE /api/presentations/:id/collaborators/:email - Remove collaborator
async function handleCollaboratorRemove(
  { storageScope, req, res, authedUser },
  presentationId,
  rawEmail,
) {
  const email = decodeURIComponent(rawEmail);

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);
  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email,
  );
  if (
    !canManageCollaborators({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  // Parse optional message from request body
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const message = parsed.body?.message || null;

  const result = await removeCollaborator(
    presentationId,
    email,
    authedUser?.email,
    {
      message,
    },
  );

  if (!result.ok) {
    return storageError(res, result);
  }

  // Log the revocation the way a grant is logged (non-blocking): a grant
  // writes collaborator.added, so a revoke writes collaborator.removed —
  // without it the security-relevant half of the model is nowhere in the
  // feed.
  try {
    await createActivityEvent(storageScope, {
      eventType: EVENT_TYPES.COLLABORATOR_REMOVED,
      entityType: ENTITY_TYPES.COLLABORATOR,
      entityId: result.collaborator?.id || presentationId,
      presentationId,
      actorEmail: authedUser?.email,
      actorName: authedUser?.name,
      data: {
        collaboratorEmail: result.collaborator?.userEmail || email,
        presentationTitle: pres.title || 'Untitled presentation',
        revocationMessage: result.collaborator?.revocationMessage || null,
      },
    });
  } catch (err) {
    log.error(
      `[collaborators] Failed to record revoke event for ${email}:`,
      err,
    );
  }

  serveJson(res, 200, { ok: true, collaborator: result.collaborator });
  return true;
}

// PATCH /api/presentations/:id/collaborators/:email - Update permission
async function handleCollaboratorUpdate(
  { storageScope, req, res, authedUser },
  presentationId,
  rawEmail,
) {
  const email = decodeURIComponent(rawEmail);

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);
  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email,
  );
  if (
    !canManageCollaborators({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  const permission = body?.permission;
  if (!validatePermission(permission, res)) return true;

  const result = await updateCollaboratorPermission(
    presentationId,
    email,
    permission,
  );

  if (!result.ok) {
    return storageError(res, result);
  }

  // Log the permission change symmetrically with grant and revoke
  // (non-blocking): a promotion or demotion is an access-model event too.
  try {
    await createActivityEvent(storageScope, {
      eventType: EVENT_TYPES.COLLABORATOR_PERMISSION_CHANGED,
      entityType: ENTITY_TYPES.COLLABORATOR,
      entityId: result.collaborator?.id || presentationId,
      presentationId,
      actorEmail: authedUser?.email,
      actorName: authedUser?.name,
      data: {
        collaboratorEmail: result.collaborator?.userEmail || email,
        permission,
        presentationTitle: pres.title || 'Untitled presentation',
      },
    });
  } catch (err) {
    log.error(
      `[collaborators] Failed to record permission-change event for ${email}:`,
      err,
    );
  }

  serveJson(res, 200, { collaborator: result.collaborator });
  return true;
}

/**
 * Declarative route table for collaborator management (A7.19 C8). Order matches
 * the previous if-chain: `shared-with-me` first, then the base-collection routes
 * split on method, then the `/:email` item routes. Method mismatch falls through
 * (the chain had no 405). The `([^/]+)` email capture is url-encoded and decoded
 * inside the handler.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/presentations/shared-with-me',
    handler: handleSharedWithMe,
  },
  {
    method: 'POST',
    pattern: /^\/api\/presentations\/([^/]+)\/collaborators$/,
    handler: handleCollaboratorAdd,
  },
  {
    method: 'GET',
    pattern: /^\/api\/presentations\/([^/]+)\/collaborators$/,
    handler: handleCollaboratorList,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/presentations\/([^/]+)\/collaborators\/([^/]+)$/,
    handler: handleCollaboratorRemove,
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/presentations\/([^/]+)\/collaborators\/([^/]+)$/,
    handler: handleCollaboratorUpdate,
  },
];

/**
 * Handle collaborator management endpoints.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleCollaborators = withErrorHandler('collaborators', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
