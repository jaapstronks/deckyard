/**
 * Actor-based presentation access checks.
 *
 * Shared by machine-client surfaces (public API, MCP tools) where the acting
 * user is identified by email only (API key owner, MCP session owner) and no
 * session/guest context exists. Wraps the canonical canRead/canWrite checks
 * with collaborator-permission lookup so machine clients follow the exact
 * same rules as the editor routes.
 *
 * ## Where the email becomes a user id
 *
 * These surfaces carry an *email*, because that is what an API key row and the
 * MCP owner setting hold — while the deciders now key on `users.id`
 * (identity-match.js). This module is that boundary: the async entry points
 * resolve the actor's email through the identity resolver once, and hand the
 * deciders an actor that carries both. An email with no `users` row resolves to
 * a defined NULL (`external: true`), which simply leaves the actor id-less and
 * the deciders on their email fallback — the same answer as before.
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
 * Pure check: can an actor (email only) read or write a presentation?
 * Collaborator permission must be supplied by the caller.
 *
 * @param {Object} options
 * @param {Object} options.pres - The presentation object
 * @param {string} options.actorEmail - The acting user's email
 * @param {string|null} [options.actorUserId=null] - The acting user's `users.id`, when resolved
 * @param {'read'|'write'} [options.access='read'] - Required access level
 * @param {string|null} [options.collaboratorPermission=null] - Collaborator permission level, if any
 * @returns {boolean}
 */
export function checkActorAccess({
  pres,
  actorEmail,
  actorUserId = null,
  access = 'read',
  collaboratorPermission = null,
} = {}) {
  if (!pres || typeof pres !== 'object') return false;
  const user = actorUser(actorEmail, pres, actorUserId);
  const check = access === 'write' ? canWritePresentation : canReadPresentation;
  return check({ user, pres, collaboratorPermission });
}

/**
 * Build the user shape the canonical checks expect from an actor we only know
 * by email (plus, once resolved, their stable user id).
 *
 * The organization is taken from the presentation, which makes the workspace
 * grant behave for machine clients exactly as it did before the authorization
 * layer became organization-aware. That is deliberate and it is not the same
 * statement as "this actor belongs to that organization": these surfaces
 * resolve their context from the API key's owner email only, so an `api_keys`
 * row belonging to another organization still reads the default one. Closing
 * that is its own piece of work, tracked as an open item in
 * docs/reference/tenant-isolation.md; until then this path must not silently
 * become the place where multi-workspace access is decided.
 *
 * @param {string} actorEmail
 * @param {Object} pres
 * @param {string|null} [actorUserId]
 * @returns {{id: string|null, email: string, organizationId: string|undefined}}
 */
function actorUser(actorEmail, pres, actorUserId = null) {
  return { id: actorUserId || null, email: actorEmail, organizationId: pres?.organizationId };
}

/**
 * Resolve an actor email to its stable `users.id`, if the instance knows one.
 *
 * Returns null for an email with no user row (an external/legacy identity, or
 * file mode, which has no `users` table) — a defined state, not a failure: the
 * deciders then fall back to the email identifier, which is what such an actor
 * has. See server/storage/identity-resolver.js.
 *
 * @param {string} actorEmail
 * @returns {Promise<string|null>}
 */
async function resolveActorUserId(actorEmail) {
  if (!actorEmail) return null;
  const resolution = await resolveIdentityByEmail(actorEmail);
  return resolution?.userId || null;
}

/**
 * Async check: fetches the actor's collaborator permission (DB-backed,
 * cached; resolves to null in file mode) and applies checkActorAccess.
 *
 * @param {Object} pres - The presentation object
 * @param {string} actorEmail - The acting user's email
 * @param {'read'|'write'} [access='read'] - Required access level
 * @returns {Promise<boolean>}
 */
export async function canActorAccessPresentation(pres, actorEmail, access = 'read') {
  if (!pres || typeof pres !== 'object') return false;
  const [collaboratorPermission, actorUserId] = await Promise.all([
    actorEmail ? getCollaboratorPermission(pres.id, actorEmail) : null,
    resolveActorUserId(actorEmail),
  ]);
  return checkActorAccess({ pres, actorEmail, actorUserId, access, collaboratorPermission });
}

/**
 * Async check: may an actor (email only) delete a presentation?
 *
 * Deletion is owner/creator-only and consults no collaborator row, so this is
 * the ownership decider with the actor's identity resolved — the machine-client
 * counterpart of the editor route's canDeletePresentation.
 *
 * @param {Object} pres - The presentation object
 * @param {string} actorEmail - The acting user's email
 * @returns {Promise<boolean>}
 */
export async function canActorDeletePresentation(pres, actorEmail) {
  if (!pres || typeof pres !== 'object') return false;
  const actorUserId = await resolveActorUserId(actorEmail);
  return canDeletePresentation({ user: actorUser(actorEmail, pres, actorUserId), pres });
}

/**
 * Async check: may an actor (email only) moderate a comment — resolve, dismiss
 * or reopen it?
 *
 * Deck-ownership-only, like the editor route's canResolveComment, with the
 * actor's identity resolved to a `users.id` first.
 *
 * @param {Object} pres - The presentation the comment lives on
 * @param {string} actorEmail - The acting user's email
 * @returns {Promise<boolean>}
 */
export async function canActorResolveComment(pres, actorEmail) {
  if (!pres || typeof pres !== 'object') return false;
  const actorUserId = await resolveActorUserId(actorEmail);
  return canResolveComment({ user: actorUser(actorEmail, pres, actorUserId), pres });
}

/**
 * Pure check: can an actor (email only) comment on a presentation?
 * Same rules as the editor routes (canCommentOnPresentation): owner/creator,
 * any workspace user, or a collaborator with comment permission or higher.
 *
 * @param {Object} options
 * @param {Object} options.pres - The presentation object
 * @param {string} options.actorEmail - The acting user's email
 * @param {string|null} [options.actorUserId=null] - The acting user's `users.id`, when resolved
 * @param {string|null} [options.collaboratorPermission=null]
 * @returns {boolean}
 */
export function checkActorCommentAccess({
  pres,
  actorEmail,
  actorUserId = null,
  collaboratorPermission = null,
} = {}) {
  if (!pres || typeof pres !== 'object') return false;
  return canCommentOnPresentation({
    user: actorUser(actorEmail, pres, actorUserId),
    pres,
    collaboratorPermission,
  });
}

/**
 * Async check: fetches the actor's collaborator permission and applies
 * checkActorCommentAccess.
 *
 * @param {Object} pres - The presentation object
 * @param {string} actorEmail - The acting user's email
 * @returns {Promise<boolean>}
 */
export async function canActorCommentOnPresentation(pres, actorEmail) {
  if (!pres || typeof pres !== 'object') return false;
  const [collaboratorPermission, actorUserId] = await Promise.all([
    actorEmail ? getCollaboratorPermission(pres.id, actorEmail) : null,
    resolveActorUserId(actorEmail),
  ]);
  return checkActorCommentAccess({ pres, actorEmail, actorUserId, collaboratorPermission });
}
