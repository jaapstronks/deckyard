/**
 * Core presentation authorization functions.
 */

import { sandboxEnabled } from '../../config/sandbox.js';
import { normalizeEmail } from '../normalize.js';
import { PERMISSIONS, canComment, canWrite, canManage } from '../../../shared/constants/permissions.js';

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
 * Check if a user can read a presentation.
 */
export function canReadPresentation({ user, pres, collaboratorPermission } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  const scope = normalizePresentationScope(pres?.scope);
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  if (scope === 'workspace') return true;

  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);

  // Owner or creator can read
  if (owner && owner === userEmail) return true;
  if (createdBy && createdBy === userEmail) return true;

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
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  if ((owner && owner === userEmail) || (createdBy && createdBy === userEmail)) return true;

  // View-only presentations are read-only for non-owners
  if (pres?.isViewOnly) return false;

  // Workspace presentations: any workspace user can write
  if (scope === 'workspace') return true;

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
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  if ((owner && owner === userEmail) || (createdBy && createdBy === userEmail)) return true;

  return false;
}

/**
 * Check if a user can change presentation scope.
 */
export function canChangePresentationScope({ user, pres, nextScope } = {}) {
  if (!pres || typeof pres !== 'object') return false;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;

  const from = normalizePresentationScope(pres?.scope);
  const to = normalizePresentationScope(nextScope);
  if (from === to) return true;

  // Admins can always change scope
  if (user?.isAdmin) return true;

  // Sandbox stance: prevent user-to-user sharing
  if (sandboxEnabled()) return false;

  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);

  // Phase 1: allow private -> workspace by owner/creator only.
  if (from === 'private' && to === 'workspace') {
    return (owner && owner === userEmail) || (createdBy && createdBy === userEmail);
  }

  // Workspace -> private is intentionally not supported for non-admin in Phase 1.
  return false;
}

/**
 * Check if a user can claim ownership of a presentation.
 * @deprecated All presentations now have owners. This function always returns false.
 */
export function canClaimOwnership({ user, pres } = {}) {
  // Legacy feature removed - all presentations now have owners
  return false;
}

/**
 * Check if a user can force release a lock on a presentation.
 */
export function canForceLockRelease({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  // Owner/creator of the presentation can force release locks.
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  return (owner && owner === userEmail) || (createdBy && createdBy === userEmail);
}

/**
 * Check if a user can transfer ownership of a presentation.
 * Only the owner/creator can transfer ownership.
 */
export function canTransferOwnership({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  return (owner && owner === userEmail) || (createdBy && createdBy === userEmail);
}

/**
 * Check if a user is the author of a presentation.
 * Authors are: owner or creator.
 * Authors can lock/unlock slides to prevent editing by collaborators.
 */
export function isPresentationAuthor({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  return (owner && owner === userEmail) || (createdBy && createdBy === userEmail);
}

/**
 * Check if a user can manage collaborators on a presentation.
 * Allowed for: owner, creator, or collaborator with 'admin' permission.
 */
export function canManageCollaborators({ user, pres, collaboratorPermission } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  if ((owner && owner === userEmail) || (createdBy && createdBy === userEmail)) return true;

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
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;

  // Owner/creator can always comment
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  if ((owner && owner === userEmail) || (createdBy && createdBy === userEmail)) return true;

  // Workspace presentations: any workspace user can comment
  const scope = normalizePresentationScope(pres?.scope);
  if (scope === 'workspace') return true;

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

  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return 'view';

  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);

  // Owner or creator always has edit permission
  if ((owner && owner === userEmail) || (createdBy && createdBy === userEmail)) return 'edit';

  // Workspace presentations handling
  const scope = normalizePresentationScope(pres?.scope);
  if (scope === 'workspace') {
    // View-only presentations allow commenting but not editing
    if (pres?.isViewOnly) return 'comment';
    // Regular workspace presentations give edit to all workspace users
    return 'edit';
  }

  // Fall back to collaborator permission, or 'view' if none
  return collaboratorPermission || 'view';
}