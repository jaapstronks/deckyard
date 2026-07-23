/**
 * API endpoint for transferring presentation ownership.
 *
 * POST /api/presentations/:id/transfer-ownership
 * Body: { newOwnerEmail: "user@example.com", keepAsCollaborator?: boolean }
 */

import { getPresentation } from '../../../storage/presentations.js';
import { transferPresentationOwnership } from '../../../storage/presentations/ownership.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { listUsers } from '../../../storage/users.js';
import { canTransferOwnership } from '../../../utils/presentation-authz.js';
import { createRouteContext } from '../../../utils/context.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  badRequest,
  requireJsonBody,
} from '../../../utils/http.js';
import { normalizeEmail } from '../../../utils/normalize.js';
import { createActivityEvent, EVENT_TYPES, ENTITY_TYPES } from '../../../storage/activity-events.js';
import { createNotification } from '../../../storage/notifications.js';
import { broadcastToUser, NotificationEventTypes } from '../../../services/notification-events.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('ownership');

export async function handleOwnershipTransfer(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const ctx = createRouteContext(authedUser);
  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for authorization check
  const collaboratorPermission = await getCollaboratorPermission(id, authedUser?.email, ctx);

  if (!canTransferOwnership({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  const newOwnerEmail = normalizeEmail(body?.newOwnerEmail);
  if (!newOwnerEmail || !newOwnerEmail.includes('@')) {
    return badRequest(res, 'Valid newOwnerEmail is required');
  }

  // Prevent transferring to self
  const currentOwner = normalizeEmail(pres?.ownerEmail || pres?.createdBy);
  if (newOwnerEmail === currentOwner) {
    return badRequest(res, 'Cannot transfer ownership to the current owner');
  }

  // Verify new owner exists in organization
  let users;
  try {
    users = await listUsers(ctx);
  } catch (err) {
    log.error('[ownership] Failed to list users:', err);
    return serveJson(res, 500, { error: 'Failed to verify user' });
  }

  const newOwnerUser = users.find((u) => normalizeEmail(u.email) === newOwnerEmail);
  if (!newOwnerUser) {
    return badRequest(res, 'New owner must be a member of the organization');
  }

  // Whether to keep old owner as collaborator
  const keepAsCollaborator = body?.keepAsCollaborator !== false; // Default true

  try {
    const result = await transferPresentationOwnership(
      repoRoot,
      id,
      {
        newOwnerEmail,
        previousOwnerEmail: currentOwner,
        keepAsCollaborator,
        actorEmail: authedUser?.email,
      },
      ctx
    );

    if (!result.ok) {
      return serveJson(res, 400, { error: result.reason });
    }

    // Create activity event (non-blocking)
    try {
      await createActivityEvent(
        {
          eventType: EVENT_TYPES.OWNERSHIP_TRANSFERRED,
          entityType: ENTITY_TYPES.PRESENTATION,
          entityId: id,
          presentationId: id,
          actorEmail: authedUser?.email,
          actorName: authedUser?.name,
          data: {
            previousOwner: currentOwner,
            newOwner: newOwnerEmail,
            presentationTitle: pres.title,
          },
        },
        ctx
      );
    } catch (err) {
      log.error('[ownership] Failed to create activity event:', err);
    }

    // Notify new owner (non-blocking)
    try {
      const host = req.headers.host || 'localhost';
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const editUrl = `${protocol}://${host}/app/${id}`;

      const notifResult = await createNotification(
        {
          userEmail: newOwnerEmail,
          notificationType: 'ownership_received',
          title: `${authedUser?.name || authedUser?.email} transferred ownership to you`,
          body: `You are now the owner of "${pres.title || 'Untitled presentation'}".`,
          presentationId: id,
          actorEmail: authedUser?.email,
          actorName: authedUser?.name,
          actionUrl: editUrl,
          data: { presentationTitle: pres.title },
        },
        ctx
      );

      if (notifResult.ok) {
        broadcastToUser(newOwnerEmail, NotificationEventTypes.NEW, notifResult.notification);
      }
    } catch (err) {
      log.error('[ownership] Failed to create notification:', err);
    }

    serveJson(res, 200, {
      ok: true,
      presentation: result.presentation,
      previousOwner: currentOwner,
      newOwner: newOwnerEmail,
      previousOwnerKeptAsCollaborator: keepAsCollaborator && result.collaboratorAdded,
    });
  } catch (err) {
    log.error('[ownership] Failed to transfer ownership:', err);
    return serveJson(res, 500, { error: 'Failed to transfer ownership' });
  }

  return true;
}