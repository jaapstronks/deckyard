/**
 * Collaborators — who has access to a deck and granting it, decided and done
 * in one place (B807).
 *
 * The internal route used to load the deck, check the input, resolve the
 * invitees in the organization and write the notification, activity row and
 * invite mail itself. The native MCP needs the same handling for an agent that
 * shares a deck privately with a colleague, and an adapter may not import a
 * route (`tests/service-layer-imports.test.js`), so the handling lives here and
 * both adapters call it with their own actor: the session user for the
 * editor, the MCP session owner for an agent.
 *
 * Granting access is not publishing: nothing here touches visibility or share
 * links. Managing collaborators is `access: 'manage'` in
 * {@link loadPresentationForActor} (owner, creator or an `admin`
 * collaborator), never plain edit.
 *
 * @module server/services/collaborators
 */

import {
  addCollaborator,
  listCollaborators,
} from '../storage/collaborators.js';
import { getUsersByEmails } from '../storage/users.js';
import { sendCollaboratorInviteEmail } from '../integrations/email/index.js';
import { createNotification } from '../storage/notifications.js';
import {
  broadcastToUser,
  NotificationEventTypes,
} from './notification-events.js';
import {
  createActivityEvent,
  EVENT_TYPES,
  ENTITY_TYPES,
} from '../storage/activity-events.js';
import { assertSharingEnabled } from '../sandbox/sharing.js';
import { isValidPermission } from '../../shared/constants/permissions.js';
import { normalizeEmail } from '../../shared/email.js';
import { ValidationError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import { loadPresentationForActor } from './presentations.js';

const log = createLogger('collaborators');

/** The most addresses one invite call may carry. */
export const MAX_INVITES_PER_CALL = 20;

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/**
 * The scope a collaborator row is read or written in: the deck's own
 * organization, which the storage layer checks against the deck row.
 * @param {StorageScope} scope
 * @param {{ organizationId: string }} pres
 * @returns {StorageScope}
 */
function deckScope(scope, pres) {
  return { ...scope, organizationId: pres.organizationId };
}

/**
 * List a deck's active collaborators with their display names.
 *
 * Refusals: an absent deck is 404, a deck the actor may not manage is 403.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The acting user.
 * @param {string} presentationId
 * @returns {Promise<{ presentation: Object, collaborators: Object[] }>}
 * @throws {import('../utils/errors.js').NotFoundError}
 * @throws {import('../utils/errors.js').ForbiddenError}
 */
export async function listCollaboratorsForActor(
  scope,
  identity,
  presentationId,
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'manage',
  });
  const collaborators = await listCollaborators(
    deckScope(scope, pres),
    presentationId,
  );
  const userMap = await getUsersByEmails(
    scope,
    collaborators.map((c) => c.userEmail),
  );
  return {
    presentation: pres,
    collaborators: collaborators.map((c) => ({
      ...c,
      userName: userMap.get(c.userEmail)?.name || null,
    })),
  };
}

/**
 * Leave the trail of a grant: the in-app notification for the invitee, the
 * activity row on the deck and, when asked, the invite mail. None of them may
 * undo a grant that happened, so a failure is a log line.
 */
async function announceGrant(
  scope,
  actor,
  pres,
  { invitee, permission, collaborator, inviteUrl, sendInvitation, repoRoot },
) {
  const presentationTitle = pres.title || 'Untitled presentation';
  const inviterName = actor?.name || actor?.email;
  const userEmail = invitee.email;

  try {
    const notified = await createNotification(scope, {
      userEmail,
      notificationType: 'share_received',
      title: `${inviterName} shared a presentation with you`,
      body: `You have been invited to "${presentationTitle}" with ${permission} access.`,
      presentationId: pres.id,
      actorEmail: actor?.email,
      actorName: actor?.name,
      actionUrl: inviteUrl,
      data: { permission, presentationTitle },
    });
    if (notified.ok) {
      broadcastToUser(
        userEmail,
        NotificationEventTypes.NEW,
        notified.notification,
      );
    }
  } catch (err) {
    log.error(
      `[collaborators] Failed to create notification for ${userEmail}:`,
      err,
    );
  }

  try {
    await createActivityEvent(scope, {
      eventType: EVENT_TYPES.COLLABORATOR_ADDED,
      entityType: ENTITY_TYPES.COLLABORATOR,
      entityId: collaborator?.id || pres.id,
      presentationId: pres.id,
      actorEmail: actor?.email,
      actorName: actor?.name,
      data: { collaboratorEmail: userEmail, permission, presentationTitle },
    });
  } catch (err) {
    log.error(
      `[collaborators] Failed to create activity event for ${userEmail}:`,
      err,
    );
  }

  if (!sendInvitation) return;
  fireAndForget(
    sendCollaboratorInviteEmail({
      recipientEmail: userEmail,
      recipientName: invitee.name || null,
      presentationTitle,
      inviterName,
      permission,
      editUrl: inviteUrl,
      repoRoot,
    }).then((emailResult) => {
      if (!emailResult.ok) {
        log.warn(
          `[email] collaborator invite email failed to=${userEmail} error=${emailResult.error || ''}`.trim(),
        );
      }
    }),
    `collaborator invite email to=${userEmail}`,
  );
}

/**
 * Grant one or more members of the organization access to a deck.
 *
 * Every refusal of the call as a whole comes before any write: sharing off
 * (sandbox, D181), absent deck (404), not allowed to manage it (403,
 * `access: 'manage'`), then the input — an unsupported `permission`, no valid
 * address, more than {@link MAX_INVITES_PER_CALL}, or only the actor's own
 * address (each a 400). After that each address is answered on its own: a
 * person who is not a member of the deck's organization is `user_not_found`,
 * an active collaborator is `already_exists` and keeps the permission they
 * have — a grant never silently changes an existing one.
 *
 * Each grant notifies the invitee in the app and lands in the activity feed.
 * The invite mail is the caller's explicit choice (`sendInvitation`); the
 * editor sends it by default, an agent only when told to.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The acting user, recorded as inviter.
 * @param {string} presentationId
 * @param {Object} input
 * @param {string[]} input.userEmails - Addresses to invite, any casing.
 * @param {string} input.permission - 'view' | 'comment' | 'edit' | 'admin'.
 * @param {boolean} input.sendInvitation - Also send the invite mail.
 * @param {(email: string) => string} input.inviteUrlFor - The link the
 *   notification and mail point the invitee at.
 * @param {string} [input.repoRoot] - For the mail template.
 * @returns {Promise<{ presentation: Object, results: Array<{ email: string,
 *   ok: boolean, reason?: string, collaborator?: Object, isNew?: boolean,
 *   reactivated?: boolean }> }>}
 * @throws {import('../sandbox/sharing.js').SharingDisabledError}
 * @throws {import('../utils/errors.js').NotFoundError}
 * @throws {import('../utils/errors.js').ForbiddenError}
 * @throws {ValidationError}
 */
export async function inviteCollaborators(
  scope,
  identity,
  presentationId,
  { userEmails, permission, sendInvitation, inviteUrlFor, repoRoot },
) {
  assertSharingEnabled();
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'manage',
  });

  if (!isValidPermission(permission)) {
    throw new ValidationError(
      'Invalid permission. Must be view, comment, edit, or admin.',
    );
  }
  let emails = (userEmails || [])
    .map((e) => normalizeEmail(e))
    .filter((e) => e && e.includes('@'));
  if (emails.length === 0) {
    throw new ValidationError(
      'Valid userEmail or userEmails array is required',
    );
  }
  if (emails.length > MAX_INVITES_PER_CALL) {
    throw new ValidationError(
      `Maximum ${MAX_INVITES_PER_CALL} users can be invited at once`,
    );
  }
  const { actor } = identity;
  const selfEmail = normalizeEmail(actor?.email);
  emails = emails.filter((e) => e !== selfEmail);
  if (emails.length === 0) {
    throw new ValidationError('Cannot add yourself as a collaborator');
  }

  const userMap = await getUsersByEmails(scope, emails);
  const results = [];

  for (const userEmail of emails) {
    const invitee = userMap.get(userEmail);
    if (!invitee) {
      results.push({ email: userEmail, ok: false, reason: 'user_not_found' });
      continue;
    }

    let result;
    try {
      result = await addCollaborator(deckScope(scope, pres), presentationId, {
        userEmail,
        permission,
        invitedBy: actor?.email,
      });
    } catch (err) {
      log.error(
        `[collaborators] Failed to add collaborator ${userEmail}:`,
        err,
      );
      results.push({ email: userEmail, ok: false, reason: 'database_error' });
      continue;
    }
    if (!result.ok) {
      results.push({ email: userEmail, ok: false, reason: result.reason });
      continue;
    }

    results.push({
      email: userEmail,
      ok: true,
      // The same shape listCollaboratorsForActor answers with.
      collaborator: { ...result.collaborator, userName: invitee.name || null },
      isNew: result.isNew,
      reactivated: result.reactivated || false,
    });
    await announceGrant(scope, actor, pres, {
      invitee,
      permission,
      collaborator: result.collaborator,
      inviteUrl: inviteUrlFor(userEmail),
      sendInvitation,
      repoRoot,
    });
  }

  return { presentation: pres, results };
}
