/**
 * Core presentation authorization functions.
 *
 * Who a deck belongs to is decided by {@link isOwnerOrCreator} in
 * identity-match.js, which keys on the stable `users.id` and falls back to the
 * email identifier only where no id exists (file mode, external/legacy rows,
 * the auth-off operator). These functions therefore never compare an email
 * themselves — see that module for the rule and why it is not a second key.
 */

import { sandboxEnabled } from '../../config/sandbox.js';
import { isMultiWorkspaceEnabled } from '../../config/features.js';
import { canComment, canWrite, canManage } from '../../../shared/constants/permissions.js';
import { hasIdentity, isOwnerOrCreator } from './identity-match.js';

/**
 * Normalize presentation scope to either 'workspace' or 'private'.
 */
export function normalizePresentationScope(scope) {
  return scope === 'workspace' ? 'workspace' : 'private';
}

/**
 * A user flagged `unrestricted` is the single trusted operator of an
 * auth-disabled install (AUTH_ENABLED=false). There is no one to protect decks
 * from, so every ownership-scoped check grants access. The flag is only set by
 * the auth-off anonymous admin (server/auth/auth.js); real (auth-enabled) users
 * never carry it, so this cannot widen access in a multi-user deployment.
 * @param {Object} [user]
 * @returns {boolean}
 */
export function isUnrestricted(user) {
  return !!user && user.unrestricted === true;
}

/**
 * Whether a person is acting in the organization that owns a presentation.
 *
 * This gates the `scope: 'workspace'` grant, which is the one grant that rests
 * on "we are in the same workspace" rather than on an explicit relation to the
 * deck (ownership, authorship, a collaborator row). Everything else is already
 * per-person and needs no organization check.
 *
 * The storage layer scopes every presentation query on `organization_id`
 * (`getOrgId(ctx)` in the Postgres adapter), so a foreign deck does not reach
 * these functions in the first place. This is defense in depth: the
 * authorization layer should not depend on the layer beneath it remembering to
 * scope. See docs/reference/tenant-isolation.md.
 *
 * Both values come along on objects the call sites already pass:
 * `user.organizationId` is the session's membership-verified organization
 * (#356), `pres.organizationId` comes off the presentation row.
 *
 * In a single-organization installation there is exactly one organization, so
 * there is nothing to compare and the answer is unconditionally yes — behaviour
 * and cost stay identical to before this check existed. In multi-workspace mode
 * an unknown organization on either side is refused rather than waved through:
 * a presentation shape that lost its organization must fail closed.
 *
 * @param {Object} [user] - Authenticated user, carrying `organizationId`
 * @param {Object} [pres] - Presentation, carrying `organizationId`
 * @returns {boolean}
 */
export function isSameOrganization(user, pres) {
  if (!isMultiWorkspaceEnabled()) return true;
  const userOrg = user?.organizationId;
  const presOrg = pres?.organizationId;
  if (!userOrg || !presOrg) return false;
  return userOrg === presOrg;
}

/**
 * Check if a user can read a presentation.
 */
export function canReadPresentation({ user, pres, collaboratorPermission } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  const scope = normalizePresentationScope(pres?.scope);
  if (!hasIdentity(user)) return false;
  if (scope === 'workspace' && isSameOrganization(user, pres)) return true;

  // Owner or creator can read
  if (isOwnerOrCreator(user, pres)) return true;

  // Collaborator with any permission can read
  if (collaboratorPermission) return true;

  return false;
}

/**
 * Check if a user can write/edit a presentation.
 */
export function canWritePresentation({ user, pres, collaboratorPermission } = {}) {
  if (isUnrestricted(user)) return true;
  // Sandbox stance: workspace decks are curated seed decks and must be read-only for guests.
  const scope = normalizePresentationScope(pres?.scope);
  if (sandboxEnabled() && scope === 'workspace') return false;

  // Owner/creator can write
  if (!hasIdentity(user)) return false;
  if (isOwnerOrCreator(user, pres)) return true;

  // View-only presentations are read-only for non-owners
  if (pres?.isViewOnly) return false;

  // Workspace presentations: any user of that same workspace can write
  if (scope === 'workspace' && isSameOrganization(user, pres)) return true;

  // Collaborator with edit or admin permission can write
  if (canWrite(collaboratorPermission)) return true;

  return false;
}

/**
 * Check if a user can delete a presentation.
 */
export function canDeletePresentation({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  // Only the owner/creator can delete.
  if (!hasIdentity(user)) return false;
  return isOwnerOrCreator(user, pres);
}

/**
 * Check if a user can change presentation scope.
 */
export function canChangePresentationScope({ user, pres, nextScope } = {}) {
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;

  const from = normalizePresentationScope(pres?.scope);
  const to = normalizePresentationScope(nextScope);
  if (from === to) return true;

  // Admins can always change scope
  if (user?.isAdmin) return true;

  // Sandbox stance: prevent user-to-user sharing
  if (sandboxEnabled()) return false;

  // Phase 1: allow private -> workspace by owner/creator only.
  if (from === 'private' && to === 'workspace') {
    return isOwnerOrCreator(user, pres);
  }

  // Workspace -> private is intentionally not supported for non-admin in Phase 1.
  return false;
}

/**
 * Check if a user can force release a lock on a presentation.
 */
export function canForceLockRelease({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  // Owner/creator of the presentation can force release locks.
  if (!hasIdentity(user)) return false;
  return isOwnerOrCreator(user, pres);
}

/**
 * Check if a user can transfer ownership of a presentation.
 * Only the owner/creator can transfer ownership.
 */
export function canTransferOwnership({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;
  return isOwnerOrCreator(user, pres);
}

/**
 * Check if a user is the author of a presentation.
 * Authors are: owner or creator.
 * Authors can lock/unlock slides to prevent editing by collaborators.
 */
export function isPresentationAuthor({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;
  return isOwnerOrCreator(user, pres);
}

/**
 * Check if a user can manage collaborators on a presentation.
 * Allowed for: owner, creator, or collaborator with 'admin' permission.
 */
export function canManageCollaborators({ user, pres, collaboratorPermission } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;
  if (isOwnerOrCreator(user, pres)) return true;

  // Collaborator with admin permission can manage collaborators
  if (canManage(collaboratorPermission)) return true;

  return false;
}

/**
 * Check if a user can comment on a presentation.
 */
export function canCommentOnPresentation({ user, pres, collaboratorPermission } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;

  // Owner/creator can always comment
  if (isOwnerOrCreator(user, pres)) return true;

  // Workspace presentations: any user of that same workspace can comment
  const scope = normalizePresentationScope(pres?.scope);
  if (scope === 'workspace' && isSameOrganization(user, pres)) return true;

  // Collaborator with comment or edit permission can comment
  if (canComment(collaboratorPermission)) return true;

  return false;
}

/**
 * Get the effective permission level for a user on a presentation.
 * Used by the client to determine which UI to show (editor vs viewer).
 * @returns {'edit' | 'comment' | 'view'}
 */
export function getEffectivePermission({ user, pres, collaboratorPermission } = {}) {
  if (isUnrestricted(user)) return 'edit';
  if (!pres || typeof pres !== 'object') return 'view';

  if (!hasIdentity(user)) return 'view';

  // Owner or creator always has edit permission
  if (isOwnerOrCreator(user, pres)) return 'edit';

  // Workspace presentations handling
  const scope = normalizePresentationScope(pres?.scope);
  if (scope === 'workspace' && isSameOrganization(user, pres)) {
    // View-only presentations allow commenting but not editing
    if (pres?.isViewOnly) return 'comment';
    // Regular workspace presentations give edit to all users of that workspace
    return 'edit';
  }

  // Fall back to collaborator permission, or 'view' if none
  return collaboratorPermission || 'view';
}