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

import { getPresentation, getFirstSlidesForIds } from '../../storage/presentations.js';
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
import { canManageCollaborators } from '../../utils/presentation-authz.js';
import { createRouteContext } from '../../utils/context.js';
import { serveJson, notFound, unauthorized, badRequest, requireJsonBody, parseJsonBody } from '../../utils/http.js';
import { validatePermission } from '../../utils/request-validators.js';
import { createNotification } from '../../storage/notifications.js';
import { broadcastToUser, NotificationEventTypes } from '../../services/notification-events.js';
import { createActivityEvent, EVENT_TYPES, ENTITY_TYPES } from '../../storage/activity-events.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { createLogger } from '../../utils/logger.js';
import { fireAndForget } from '../../utils/fire-and-forget.js';
const log = createLogger('collaborators');

/**
 * Handle collaborator management endpoints.
 */
export async function handleCollaborators({ repoRoot, req, res, url, authedUser }) {
  const ctx = createRouteContext(authedUser);

  // GET /api/presentations/shared-with-me - List presentations shared with current user
  const sharedWithMeMatch = url.pathname === '/api/presentations/shared-with-me';
  if (sharedWithMeMatch && req.method === 'GET') {
    if (!authedUser?.email) {
      return unauthorized(res);
    }

    try {
      const presentations = await listPresentationsSharedWithUser(authedUser.email, ctx);

      // Batch-fetch first slides for all presentations (avoids N+1 queries).
      // The grid only needs the presence signal — the thumbnail is a
      // server-rasterized PNG — so this collapses to a boolean.
      const ids = presentations.map((p) => p.id);
      const firstSlidesMap = await getFirstSlidesForIds(repoRoot, ids);

      const presentationsWithSlides = presentations.map((p) => ({
        ...p,
        hasSlides: !!firstSlidesMap.get(p.id),
      }));

      serveJson(res, 200, { presentations: presentationsWithSlides });
    } catch (err) {
      log.error('[collaborators] Failed to list shared presentations:', err);
      return serveJson(res, 500, { error: 'Failed to load shared presentations' });
    }
    return true;
  }

  // POST /api/presentations/:id/collaborators - Add collaborator(s)
  const baseMatch = url.pathname.match(/^\/api\/presentations\/([^/]+)\/collaborators$/);
  if (baseMatch && req.method === 'POST') {
    const presentationId = baseMatch[1];
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    const collaboratorPermission = await getCollaboratorPermission(presentationId, authedUser?.email, ctx);
    if (!canManageCollaborators({ user: authedUser, pres, collaboratorPermission })) {
      return unauthorized(res);
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
    let users;
    try {
      users = await listUsers(ctx);
    } catch (err) {
      log.error('[collaborators] Failed to list users:', err);
      return serveJson(res, 500, { error: 'Failed to load users' });
    }
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
        result = await addCollaborator(
          presentationId,
          {
            userEmail,
            permission,
            invitedBy: authedUser?.email,
          },
          ctx
        );
      } catch (err) {
        log.error(`[collaborators] Failed to add collaborator ${userEmail}:`, err);
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
        const notifResult = await createNotification(
          {
            userEmail,
            notificationType: 'share_received',
            title: `${inviterName} shared a presentation with you`,
            body: `You have been invited to "${presentationTitle}" with ${permission} access.`,
            presentationId,
            actorEmail: authedUser?.email,
            actorName: authedUser?.name,
            actionUrl: editUrl,
            data: { permission, presentationTitle },
          },
          ctx
        );

        // Broadcast notification via SSE
        if (notifResult.ok) {
          broadcastToUser(userEmail, NotificationEventTypes.NEW, notifResult.notification);
        }
      } catch (err) {
        // Log but don't fail the invite if notification fails
        log.error(`[collaborators] Failed to create notification for ${userEmail}:`, err);
      }

      // Create activity event for the activity feed (non-blocking)
      try {
        await createActivityEvent(
          {
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
          },
          ctx
        );
      } catch (err) {
        // Log but don't fail the invite if activity event fails
        log.error(`[collaborators] Failed to create activity event for ${userEmail}:`, err);
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
                `[brevo] collaborator invite email failed to=${userEmail} error=${emailResult.error || ''}`.trim()
              );
            }
          }),
          `collaborator invite email to=${userEmail}`
        );
      }
    }

    // Return appropriate response based on single or batch mode
    if (emailsToInvite.length === 1 && !Array.isArray(body?.userEmails)) {
      // Single mode response (backward compatible)
      const singleResult = results[0];
      if (!singleResult.ok) {
        if (singleResult.reason === 'already_exists') {
          return serveJson(res, 409, { error: 'already_exists' });
        }
        if (singleResult.reason === 'user_not_found') {
          return badRequest(res, 'User not found in organization');
        }
        return badRequest(res, singleResult.reason);
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
  if (baseMatch && req.method === 'GET') {
    const presentationId = baseMatch[1];
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    const collaboratorPermission = await getCollaboratorPermission(presentationId, authedUser?.email, ctx);
    if (!canManageCollaborators({ user: authedUser, pres, collaboratorPermission })) {
      return unauthorized(res);
    }

    try {
      const collaborators = await listCollaborators(presentationId, ctx);

      // Enrich with user names if available
      const users = await listUsers(ctx);
      const userMap = new Map(users.map((u) => [u.email?.toLowerCase(), u]));

      const enrichedCollaborators = collaborators.map((c) => {
        const user = userMap.get(c.userEmail?.toLowerCase());
        return {
          ...c,
          userName: user?.name || null,
        };
      });

      serveJson(res, 200, { collaborators: enrichedCollaborators });
    } catch (err) {
      log.error('[collaborators] Failed to list collaborators:', err);
      return serveJson(res, 500, { error: 'Failed to load collaborators' });
    }
    return true;
  }

  // DELETE /api/presentations/:id/collaborators/:email - Remove collaborator
  const deleteMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/collaborators\/([^/]+)$/
  );
  if (deleteMatch && req.method === 'DELETE') {
    const presentationId = deleteMatch[1];
    const email = decodeURIComponent(deleteMatch[2]);
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    const collaboratorPermission = await getCollaboratorPermission(presentationId, authedUser?.email, ctx);
    if (!canManageCollaborators({ user: authedUser, pres, collaboratorPermission })) {
      return unauthorized(res);
    }

    // Parse optional message from request body
    const { body } = await parseJsonBody(req);
    const message = body?.message || null;

    try {
      const result = await removeCollaborator(
        presentationId,
        email,
        authedUser?.email,
        { message },
        ctx
      );

      if (!result.ok) {
        if (result.reason === 'not_found') return notFound(res);
        return badRequest(res, result.reason);
      }

      serveJson(res, 200, { ok: true });
    } catch (err) {
      log.error('[collaborators] Failed to remove collaborator:', err);
      return serveJson(res, 500, { error: 'Failed to remove collaborator' });
    }
    return true;
  }

  // PATCH /api/presentations/:id/collaborators/:email - Update permission
  if (deleteMatch && req.method === 'PATCH') {
    const presentationId = deleteMatch[1];
    const email = decodeURIComponent(deleteMatch[2]);
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);
    const collaboratorPermission = await getCollaboratorPermission(presentationId, authedUser?.email, ctx);
    if (!canManageCollaborators({ user: authedUser, pres, collaboratorPermission })) {
      return unauthorized(res);
    }

    const jsonResult = await requireJsonBody(req, res);
    if (!jsonResult.ok) return true;
    const body = jsonResult.body;

    const permission = body?.permission;
    if (!validatePermission(permission, res)) return true;

    try {
      const result = await updateCollaboratorPermission(
        presentationId,
        email,
        permission,
        ctx
      );

      if (!result.ok) {
        if (result.reason === 'not_found') return notFound(res);
        return badRequest(res, result.reason);
      }

      serveJson(res, 200, { collaborator: result.collaborator });
    } catch (err) {
      log.error('[collaborators] Failed to update collaborator permission:', err);
      return serveJson(res, 500, { error: 'Failed to update permission' });
    }
    return true;
  }

  return false;
}