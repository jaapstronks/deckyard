/**
 * Visibility — moving a deck between private and the organization, decided
 * and done in one place (A7.4, B574).
 *
 * The internal route used to load the deck without asking whether the caller
 * could read it, ask `canChangePresentationVisibility` and `isPresentationAuthor`
 * on its own, write the whole deck back to change two columns, and fire the
 * webhook itself; the activity row for a deck moved to the organization was
 * written only by the editor-save path, which can never change visibility, so
 * it was never written at all. Only the internal contract offers the handling;
 * the service exists so the decision lives beside the other deck rights and no
 * route decides who may do what on a deck (brief `one-service-layer.md`).
 *
 * @module server/services/visibility
 */

import { updatePresentation } from '../storage/presentations/index.js';
import { repoRootOf } from '../storage/scope.js';
import { assertSharingEnabled } from '../sandbox/sharing.js';
import {
  canActorChangeVisibility,
  canActorSetViewOnly,
} from '../utils/presentation-authz/index.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import { maybeFireWebhook } from '../utils/webhooks.js';
import { getAppBaseUrl } from '../config/utils.js';
import { loadPresentationForActor } from './presentations.js';
import { recordPresentationMovedToOrganization } from './activity-events.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/** The visibilities a deck can be moved to. */
const VISIBILITIES = new Set(['private', 'organization']);

/** @param {string} field @param {string} message */
function invalid(field, message) {
  return new AppError(message, 400, { field }, 'invalid');
}

/**
 * Leave the trail of a deck opened to the organization: the activity row and
 * the configured webhook. Neither may undo a change that happened, so both
 * run in the background.
 */
function announceMovedToOrganization(scope, actor, pres, previousVisibility) {
  fireAndForget(
    recordPresentationMovedToOrganization({
      presentation: pres,
      actor,
      previousVisibility,
      scope,
    }),
    'record presentation-moved activity',
  );
  // No request here, so the payload's links are built on the configured
  // public base (`maybeFireWebhook`).
  fireAndForget(
    maybeFireWebhook(repoRootOf(scope), getAppBaseUrl() || null, {
      event: 'presentation.moved_to_organization',
      pres,
      authedUser: actor,
      extra: {
        fromVisibility: previousVisibility,
        toVisibility: pres.visibility,
      },
    }),
    'presentation-moved webhook',
  );
}

/**
 * Move a deck to `private` or to the organization, and set or clear its
 * view-only flag.
 *
 * Every refusal comes before the write: a `visibility` that is neither
 * `private` nor `organization` (400 `invalid`), sharing off when the deck is
 * opened to the organization (sandbox, D181; moving back to private is not
 * sharing), absent deck (404), unreadable deck (403: read is the floor, as for
 * every deck right), a transition the caller may not make (403,
 * `canChangePresentationVisibility`), a non-boolean `isViewOnly` (400
 * `invalid`), view-only set by someone who is not an author (403), view-only
 * on a private deck (400 `invalid`), and no revision to write against (428
 * `missing_if_match`). Nothing is coerced.
 *
 * Moving a deck to private clears its view-only flag: view-only is a
 * restriction on organization members, and a private deck has none.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - Who changes the deck.
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {string} input.visibility - `'private'` or `'organization'`.
 * @param {boolean} [input.isViewOnly] - Omitted keeps the flag as it is.
 * @param {number|null} input.expectedRevision - The revision the caller saw
 *   (`If-Match`); the write is refused when the deck moved on since.
 * @returns {Promise<Object>} The updated presentation.
 * @throws {AppError} 400 `invalid` with `details.field`, 428
 *   `missing_if_match`, a storage refusal, or a `ConflictError` from the
 *   revision check.
 * @throws {import('../sandbox/sharing.js').SharingDisabledError}
 * @throws {NotFoundError}
 * @throws {ForbiddenError}
 */
export async function changeVisibility(scope, identity, input = {}) {
  const { presentationId, visibility, isViewOnly, expectedRevision } = input;
  if (!VISIBILITIES.has(visibility)) {
    throw invalid('visibility', 'visibility must be private or organization');
  }
  // Opening a deck to the organization is sharing; moving one back to private
  // is not, so only the widening direction asks the declaration (D181).
  if (visibility === 'organization') assertSharingEnabled();

  const pres = await loadPresentationForActor(scope, identity, presentationId);
  const { actor } = identity;
  if (!(await canActorChangeVisibility(pres, actor, visibility))) {
    throw new ForbiddenError(
      'You may not change the visibility of this presentation',
    );
  }

  let nextIsViewOnly = pres.isViewOnly === true;
  if (isViewOnly !== undefined) {
    if (typeof isViewOnly !== 'boolean') {
      throw invalid('isViewOnly', 'isViewOnly must be a boolean');
    }
    if (!(await canActorSetViewOnly(pres, actor))) {
      throw new ForbiddenError('Only the owner can set view-only status');
    }
    if (isViewOnly && visibility !== 'organization') {
      throw invalid(
        'isViewOnly',
        'View-only presentations must be visible to the organization',
      );
    }
    nextIsViewOnly = isViewOnly;
  }
  if (visibility === 'private') nextIsViewOnly = false;

  // Required of everyone, admins included (no escape hatch).
  if (expectedRevision == null) {
    throw new AppError(
      'Missing If-Match revision',
      428,
      null,
      'missing_if_match',
    );
  }

  // Only the two columns: the deck's slides are not part of this write, so
  // they are neither re-validated nor counted as authored.
  const updated = await updatePresentation(
    scope,
    pres.id,
    { visibility, isViewOnly: nextIsViewOnly },
    {
      expectedRevision,
      actorEmail: actor?.email || null,
      allowVisibilityChange: true,
      allowViewOnlyChange: true,
    },
  );
  if (!updated) throw new NotFoundError('Presentation not found');
  if (updated.ok === false) {
    throwStorageFailure(updated, 'Visibility change failed');
  }

  const previousVisibility = pres.visibility || 'private';
  if (
    previousVisibility !== 'organization' &&
    updated.visibility === 'organization'
  ) {
    announceMovedToOrganization(scope, actor, updated, previousVisibility);
  }
  return updated;
}
