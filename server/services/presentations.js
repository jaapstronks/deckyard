/**
 * Presentations — the one place a deck is loaded for someone, on every contract
 * (A7.4, B519).
 *
 * Every by-id deck route used to load and decide on its own: the internal
 * `withPresentationAuth` family with the session user, the public v1
 * `getPresentationWithAccess` with the key owner, MCP's
 * `loadPresentationChecked` with the session owner, and v1's DELETE with a
 * hand-rolled e-mail comparison that ignored `ownerId` (D22) and let any
 * writing key remove a deck without an `ownerEmail`. The deciders underneath
 * were the same; the loading, the order of the checks and the answers were
 * not. Now each contract resolves its own identity, calls
 * {@link loadPresentationForActor} and renders the refusal in its envelope
 * (brief `one-service-layer.md`, D252–D255).
 *
 * The answer is the same on all three contracts (D255):
 *
 *   - **404** (`NotFoundError`) — no deck with this id in the caller's scope.
 *     A deck in another organization is absent, not forbidden: the storage
 *     scope already answers `null` for it.
 *   - **403** (`ForbiddenError`) — the deck is there and the caller may not
 *     read it, or may read it but lacks the right the handling asks for.
 *
 * @module server/services/presentations
 */

import { getPresentation } from '../storage/presentations/index.js';
import {
  canActorAccessPresentation,
  canActorDeletePresentation,
  canActorManageCollaborators,
  canActorCommentOnPresentation,
  canGuestComment,
} from '../utils/presentation-authz/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('./actor.js').ServiceIdentity} ServiceIdentity
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 * @typedef {'read'|'write'|'delete'|'manage'|'comment'} PresentationAccess
 */

/**
 * What an actor needs for each right, and what a refusal says. Read is the
 * baseline every other right is checked on top of.
 *
 * @type {Record<PresentationAccess, { allows: (pres: Object, actor: Actor) => Promise<boolean>, refusal: string }>}
 */
const ACTOR_RIGHTS = {
  read: {
    allows: (pres, actor) => canActorAccessPresentation(pres, actor, 'read'),
    refusal: 'Access denied to this presentation',
  },
  write: {
    allows: (pres, actor) => canActorAccessPresentation(pres, actor, 'write'),
    refusal: 'You have read-only access to this presentation',
  },
  delete: {
    allows: canActorDeletePresentation,
    refusal: 'Only the presentation owner can delete it',
  },
  manage: {
    allows: canActorManageCollaborators,
    refusal:
      'Only the owner or an admin collaborator can manage this presentation',
  },
  comment: {
    allows: canActorCommentOnPresentation,
    refusal: 'You may not comment on this presentation',
  },
};

/**
 * What a share-link guest may do with a deck: read the deck their link names,
 * and comment when the link grants it. Nothing else — a guest never writes,
 * deletes or manages.
 *
 * @param {Object} pres
 * @param {import('./actor.js').GuestIdentity} identity
 * @param {PresentationAccess} access
 * @returns {boolean}
 */
function guestAllows(pres, { guest, shareLink }, access) {
  if (access === 'read') return shareLink?.presentationId === pres.id;
  if (access === 'comment') {
    return canGuestComment({ guest, shareLink, presentationId: pres.id });
  }
  return false;
}

/**
 * Why an identity may not do `access` on a deck it already holds, or `null`
 * when it may. Read is checked first for an actor, so a refusal says whether
 * the deck is unreadable or only the right is missing.
 *
 * @param {Object} pres
 * @param {ServiceIdentity} identity
 * @param {PresentationAccess} access
 * @returns {Promise<string|null>}
 */
async function refusal(pres, identity, access) {
  const right = ACTOR_RIGHTS[access];
  if (!right) throw new Error(`Unknown presentation access: ${access}`);
  if ('guest' in identity) {
    return guestAllows(pres, identity, access) ? null : right.refusal;
  }
  const { actor } = identity;
  if (!(await ACTOR_RIGHTS.read.allows(pres, actor))) {
    return ACTOR_RIGHTS.read.refusal;
  }
  if (access !== 'read' && !(await right.allows(pres, actor))) {
    return right.refusal;
  }
  return null;
}

/**
 * Load a deck by id for someone who wants to do something with it.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {ServiceIdentity} identity - `{ actor }`, or `{ guest, shareLink }`
 *   for a share-link guest (internal contract only, D253).
 * @param {string} presentationId
 * @param {Object} [options]
 * @param {PresentationAccess} [options.access='read'] - The right the handling
 *   needs.
 * @returns {Promise<Object>} The presentation.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {ForbiddenError} The deck is there, the right is not.
 */
export async function loadPresentationForActor(
  scope,
  identity,
  presentationId,
  { access = 'read' } = {},
) {
  if (!ACTOR_RIGHTS[access]) {
    throw new Error(`Unknown presentation access: ${access}`);
  }
  const pres = presentationId
    ? await getPresentation(scope, presentationId)
    : null;
  if (!pres) throw new NotFoundError('Presentation not found');

  const refused = await refusal(pres, identity, access);
  if (refused) throw new ForbiddenError(refused);
  return pres;
}

/**
 * Whether an identity may do `access` on a deck the caller already loaded —
 * the same decision as {@link loadPresentationForActor}, as a boolean, for a
 * handling that reports a capability or degrades instead of refusing (the
 * collab socket opens read-only; the question feed reports whether promoting
 * is allowed).
 *
 * @param {Object} pres
 * @param {ServiceIdentity} identity
 * @param {PresentationAccess} [access='read']
 * @returns {Promise<boolean>}
 */
export async function mayOnPresentation(pres, identity, access = 'read') {
  if (!pres || typeof pres !== 'object') return false;
  return (await refusal(pres, identity, access)) === null;
}
