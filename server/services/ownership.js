/**
 * Ownership transfer — handing a deck to someone else, decided and done in one
 * place (A7.4, B573).
 *
 * The internal route used to load the deck, ask `canTransferOwnership` and
 * check the new owner on its own, then write the activity row and the
 * notification itself. Only the internal contract offers the handling; the
 * service exists so the decision lives beside the other deck rights
 * (`access: 'transfer'` in {@link loadPresentationForActor}) and no route
 * decides who may do what on a deck (brief `one-service-layer.md`).
 *
 * @module server/services/ownership
 */

import { transferPresentationOwnership } from '../storage/presentations/ownership.js';
import { getUserByEmail } from '../storage/users.js';
import {
  createActivityEvent,
  EVENT_TYPES,
  ENTITY_TYPES,
} from '../storage/activity-events.js';
import { createNotification } from '../storage/notifications.js';
import {
  broadcastToUser,
  NotificationEventTypes,
} from './notification-events.js';
import { assertSharingEnabled } from '../sandbox/sharing.js';
import { normalizeEmail } from '../utils/normalize.js';
import { AppError, throwStorageFailure } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { loadPresentationForActor } from './presentations.js';

const log = createLogger('ownership');

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/** @param {string} field @param {string} message */
function invalid(field, message) {
  return new AppError(message, 400, { field }, 'invalid');
}

/**
 * Leave the trail of a transfer: the activity row on the deck and an in-app
 * notification for the new owner. Neither may undo a transfer that happened,
 * so a failure is a log line.
 */
async function announceTransfer(scope, actor, pres, { from, to }) {
  try {
    await createActivityEvent(scope, {
      eventType: EVENT_TYPES.OWNERSHIP_TRANSFERRED,
      entityType: ENTITY_TYPES.PRESENTATION,
      entityId: pres.id,
      presentationId: pres.id,
      actorEmail: actor?.email,
      actorName: actor?.name,
      data: {
        previousOwner: from,
        newOwner: to,
        presentationTitle: pres.title,
      },
    });
  } catch (err) {
    log.error('[ownership] Failed to create activity event:', err);
  }

  try {
    // Relative, as every in-app notification link is: the bell resolves it
    // against the origin it runs on.
    const notified = await createNotification(scope, {
      userEmail: to,
      notificationType: 'ownership_received',
      title: `${actor?.name || actor?.email} transferred ownership to you`,
      body: `You are now the owner of "${pres.title || 'Untitled presentation'}".`,
      presentationId: pres.id,
      actorEmail: actor?.email,
      actorName: actor?.name,
      actionUrl: `/app/${pres.id}`,
      data: { presentationTitle: pres.title },
    });
    if (notified.ok) {
      broadcastToUser(to, NotificationEventTypes.NEW, notified.notification);
    }
  } catch (err) {
    log.error('[ownership] Failed to create notification:', err);
  }
}

/**
 * Hand a deck to another member of the organization.
 *
 * Every refusal comes before the write: sharing off (sandbox, D181), absent
 * deck (404), not the owner (403, `access: 'transfer'`), then the input —
 * `newOwnerEmail` not an address, the current owner, or nobody in the
 * organization, and a `keepAsCollaborator` that is not a boolean. Each is a
 * 400 `invalid` naming the field; nothing is coerced.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The owner handing the deck over.
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {string} input.newOwnerEmail - The new owner's address, any casing.
 * @param {boolean} [input.keepAsCollaborator=true] - Keep the previous owner
 *   on the deck as an edit collaborator.
 * @returns {Promise<{ presentation: Object, previousOwner: string|null,
 *   newOwner: string, previousOwnerKeptAsCollaborator: boolean }>}
 * @throws {import('../sandbox/sharing.js').SharingDisabledError}
 * @throws {import('../utils/errors.js').NotFoundError}
 * @throws {import('../utils/errors.js').ForbiddenError}
 * @throws {AppError} 400 `invalid` with `details.field`, or a storage refusal.
 */
export async function transferOwnership(scope, identity, input = {}) {
  assertSharingEnabled();
  const { presentationId, keepAsCollaborator = true } = input;
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'transfer',
  });

  const newOwner = normalizeEmail(input.newOwnerEmail);
  if (!newOwner || !newOwner.includes('@')) {
    throw invalid('newOwnerEmail', 'Valid newOwnerEmail is required');
  }
  // The owner stamp is the only one that still carries an address (D22).
  const previousOwner = normalizeEmail(pres.ownerEmail) || null;
  if (newOwner === previousOwner) {
    throw invalid(
      'newOwnerEmail',
      'Cannot transfer ownership to the current owner',
    );
  }
  if (typeof keepAsCollaborator !== 'boolean') {
    throw invalid('keepAsCollaborator', 'keepAsCollaborator must be a boolean');
  }
  if (!(await getUserByEmail(scope, newOwner))) {
    throw invalid(
      'newOwnerEmail',
      'New owner must be a member of the organization',
    );
  }

  const { actor } = identity;
  const result = await transferPresentationOwnership(scope, pres.id, {
    newOwnerEmail: newOwner,
    previousOwnerEmail: previousOwner,
    keepAsCollaborator,
    actorEmail: actor?.email,
  });
  if (!result.ok) throwStorageFailure(result, 'Ownership transfer failed');

  await announceTransfer(scope, actor, pres, {
    from: previousOwner,
    to: newOwner,
  });
  return {
    presentation: result.presentation,
    previousOwner,
    newOwner,
    previousOwnerKeptAsCollaborator:
      keepAsCollaborator && result.collaboratorAdded,
  };
}
