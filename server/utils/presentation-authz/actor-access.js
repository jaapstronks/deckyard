/**
 * Actor-based presentation access checks.
 *
 * Shared by machine-client surfaces (public API, MCP tools) where the acting
 * party is an API key or an MCP session rather than a browser session. Wraps the
 * canonical canRead/canWrite checks with collaborator-permission lookup so
 * machine clients follow the exact same rules as the editor routes.
 *
 * ## An actor is an identity *and* a workspace
 *
 * Every entry point here takes an **actor**: `{ email, organizationId }`. Both
 * halves are load-bearing and neither can be derived from the deck:
 *
 *   - the **email** is the identity these surfaces hold (an `api_keys` row's
 *     owner, the MCP session owner). The deciders key on `users.id`
 *     (shared/identity-match.js), so this module resolves it through the identity
 *     resolver once per check. An email with no `users` row resolves to a
 *     defined NULL and simply leaves the actor id-less, putting the deciders on
 *     their email fallback — the same answer as before;
 *   - the **organization** is the workspace the key or session acts in, and it
 *     gates the one grant that rests on "we are in the same workspace"
 *     (`isSameOrganization`). It used to be read off the presentation being
 *     checked, which made that grant unconditional for machine clients: whatever
 *     workspace the deck was in, the actor appeared to be in it. Taking it from
 *     the caller is what turns the check into a check (L10).
 *
 * There is no fallback when an actor states no organization: in single-workspace
 * mode there is nothing to compare and `isSameOrganization` answers yes from the
 * feature flag, and in multi-workspace mode a workspace grant with no stated
 * workspace fails closed. Grants that rest on a relation to the deck itself —
 * ownership, a collaborator row — do not consult the organization at all and are
 * unaffected either way.
 */

import { getCollaboratorPermission } from '../../storage/collaborators.js';
import { resolveIdentityByEmail } from '../../storage/identity-resolver.js';
import {
  canReadPresentation,
  canWritePresentation,
  canCommentOnPresentation,
  canDeletePresentation,
} from './presentations.js';
import { canResolveComment } from './comments.js';

/**
 * The acting machine client.
 *
 * @typedef {Object} Actor
 * @property {string} email - The identity: API key owner / MCP session owner.
 * @property {string|null} [organizationId] - The workspace the key or session acts in.
 */

/**
 * Pure check: can an actor read or write a presentation?
 * Collaborator permission must be supplied by the caller.
 *
 * @param {Object} options
 * @param {Object} options.pres - The presentation object
 * @param {Actor} options.actor - The acting machine client
 * @param {string|null} [options.actorUserId=null] - The actor's `users.id`, when resolved
 * @param {'read'|'write'} [options.access='read'] - Required access level
 * @param {string|null} [options.collaboratorPermission=null] - Collaborator permission level, if any
 * @returns {boolean}
 */
export function checkActorAccess({
  pres,
  actor,
  actorUserId = null,
  access = 'read',
  collaboratorPermission = null,
} = {}) {
  if (!pres || typeof pres !== 'object') return false;
  const user = actorUser(actor, actorUserId);
  const check = access === 'write' ? canWritePresentation : canReadPresentation;
  return check({ user, pres, collaboratorPermission });
}

/**
 * Build the user shape the canonical checks expect from an actor.
 *
 * @param {Actor} [actor]
 * @param {string|null} [actorUserId]
 * @returns {{id: string|null, email: string|undefined, organizationId: string|null}}
 */
function actorUser(actor, actorUserId = null) {
  return {
    id: actorUserId || null,
    email: actor?.email,
    organizationId: actor?.organizationId || null,
  };
}

/**
 * Resolve an actor's email to its stable `users.id`, if the instance knows one.
 *
 * Returns null for an email with no user row (an external/legacy identity, or
 * file mode, which has no `users` table) — a defined state, not a failure: the
 * deciders then fall back to the email identifier, which is what such an actor
 * has. See server/storage/identity-resolver.js.
 *
 * @param {Actor} [actor]
 * @returns {Promise<string|null>}
 */
async function resolveActorUserId(actor) {
  if (!actor?.email) return null;
  const resolution = await resolveIdentityByEmail(actor.email);
  return resolution?.userId || null;
}

/**
 * Async check: fetches the actor's collaborator permission (DB-backed,
 * cached; resolves to null in file mode) and applies checkActorAccess.
 *
 * @param {Object} pres - The presentation object
 * @param {Actor} actor - The acting machine client
 * @param {'read'|'write'} [access='read'] - Required access level
 * @returns {Promise<boolean>}
 */
export async function canActorAccessPresentation(pres, actor, access = 'read') {
  if (!pres || typeof pres !== 'object') return false;
  const [collaboratorPermission, actorUserId] = await Promise.all([
    actor?.email ? getCollaboratorPermission(pres.id, actor.email) : null,
    resolveActorUserId(actor),
  ]);
  return checkActorAccess({ pres, actor, actorUserId, access, collaboratorPermission });
}

/**
 * Async check: may an actor delete a presentation?
 *
 * Deletion is owner/creator-only and consults no collaborator row, so this is
 * the ownership decider with the actor's identity resolved — the machine-client
 * counterpart of the editor route's canDeletePresentation.
 *
 * @param {Object} pres - The presentation object
 * @param {Actor} actor - The acting machine client
 * @returns {Promise<boolean>}
 */
export async function canActorDeletePresentation(pres, actor) {
  if (!pres || typeof pres !== 'object') return false;
  const actorUserId = await resolveActorUserId(actor);
  return canDeletePresentation({ user: actorUser(actor, actorUserId), pres });
}

/**
 * Async check: may an actor moderate a comment — resolve, dismiss or reopen it?
 *
 * Deck-ownership-only, like the editor route's canResolveComment, with the
 * actor's identity resolved to a `users.id` first.
 *
 * @param {Object} pres - The presentation the comment lives on
 * @param {Actor} actor - The acting machine client
 * @returns {Promise<boolean>}
 */
export async function canActorResolveComment(pres, actor) {
  if (!pres || typeof pres !== 'object') return false;
  const actorUserId = await resolveActorUserId(actor);
  return canResolveComment({ user: actorUser(actor, actorUserId), pres });
}

/**
 * Pure check: can an actor comment on a presentation?
 * Same rules as the editor routes (canCommentOnPresentation): owner/creator,
 * any user of that same workspace, or a collaborator with comment permission or
 * higher.
 *
 * @param {Object} options
 * @param {Object} options.pres - The presentation object
 * @param {Actor} options.actor - The acting machine client
 * @param {string|null} [options.actorUserId=null] - The actor's `users.id`, when resolved
 * @param {string|null} [options.collaboratorPermission=null]
 * @returns {boolean}
 */
export function checkActorCommentAccess({
  pres,
  actor,
  actorUserId = null,
  collaboratorPermission = null,
} = {}) {
  if (!pres || typeof pres !== 'object') return false;
  return canCommentOnPresentation({
    user: actorUser(actor, actorUserId),
    pres,
    collaboratorPermission,
  });
}

/**
 * Async check: fetches the actor's collaborator permission and applies
 * checkActorCommentAccess.
 *
 * @param {Object} pres - The presentation object
 * @param {Actor} actor - The acting machine client
 * @returns {Promise<boolean>}
 */
export async function canActorCommentOnPresentation(pres, actor) {
  if (!pres || typeof pres !== 'object') return false;
  const [collaboratorPermission, actorUserId] = await Promise.all([
    actor?.email ? getCollaboratorPermission(pres.id, actor.email) : null,
    resolveActorUserId(actor),
  ]);
  return checkActorCommentAccess({ pres, actor, actorUserId, collaboratorPermission });
}
