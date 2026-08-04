/**
 * Actor-based presentation access checks.
 *
 * Shared by machine-client surfaces (public API, MCP tools) where the acting
 * user is identified by email only (API key owner, MCP session owner) and no
 * session/guest context exists. Wraps the canonical canRead/canWrite checks
 * with collaborator-permission lookup so machine clients follow the exact
 * same rules as the editor routes.
 */

import { getCollaboratorPermission } from '../../storage/collaborators.js';
import {
  canReadPresentation,
  canWritePresentation,
  canCommentOnPresentation,
} from './presentations.js';

/**
 * Pure check: can an actor (email only) read or write a presentation?
 * Collaborator permission must be supplied by the caller.
 *
 * @param {Object} options
 * @param {Object} options.pres - The presentation object
 * @param {string} options.actorEmail - The acting user's email
 * @param {'read'|'write'} [options.access='read'] - Required access level
 * @param {string|null} [options.collaboratorPermission=null] - Collaborator permission level, if any
 * @returns {boolean}
 */
export function checkActorAccess({ pres, actorEmail, access = 'read', collaboratorPermission = null } = {}) {
  if (!pres || typeof pres !== 'object') return false;
  const user = actorUser(actorEmail, pres);
  const check = access === 'write' ? canWritePresentation : canReadPresentation;
  return check({ user, pres, collaboratorPermission });
}

/**
 * Build the user shape the canonical checks expect from an actor we only know
 * by email.
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
 * @returns {{email: string, organizationId: string|undefined}}
 */
function actorUser(actorEmail, pres) {
  return { email: actorEmail, organizationId: pres?.organizationId };
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
  const collaboratorPermission = actorEmail
    ? await getCollaboratorPermission(pres.id, actorEmail, { organizationId: pres.organizationId })
    : null;
  return checkActorAccess({ pres, actorEmail, access, collaboratorPermission });
}

/**
 * Pure check: can an actor (email only) comment on a presentation?
 * Same rules as the editor routes (canCommentOnPresentation): owner/creator,
 * any workspace user, or a collaborator with comment permission or higher.
 *
 * @param {Object} options
 * @param {Object} options.pres - The presentation object
 * @param {string} options.actorEmail - The acting user's email
 * @param {string|null} [options.collaboratorPermission=null]
 * @returns {boolean}
 */
export function checkActorCommentAccess({ pres, actorEmail, collaboratorPermission = null } = {}) {
  if (!pres || typeof pres !== 'object') return false;
  return canCommentOnPresentation({ user: actorUser(actorEmail, pres), pres, collaboratorPermission });
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
  const collaboratorPermission = actorEmail
    ? await getCollaboratorPermission(pres.id, actorEmail, { organizationId: pres.organizationId })
    : null;
  return checkActorCommentAccess({ pres, actorEmail, collaboratorPermission });
}
