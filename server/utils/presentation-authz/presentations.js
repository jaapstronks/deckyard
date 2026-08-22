/**
 * Core presentation authorization functions.
 *
 * Who a deck belongs to is decided in shared/identity-match.js, which keys on
 * the stable `users.id` and on nothing else: a stamp whose id column is a
 * defined NULL (an external or legacy row) names nobody. These functions
 * therefore never compare an email themselves — see that module for the rule
 * and why an address is not a second key.
 *
 * ## Two stamps, two questions (D43, D49)
 *
 * A deck carries an **owner** and a **creator**, and they answer different
 * questions. Power over the object — writing it, deleting it, changing who may
 * see it, handing out access to it — reads {@link isOwner} alone. Authorship
 * (slide locks, comment moderation) and sight (reading it, seeing it in a
 * list) read {@link isOwnerOrCreator}, because making a deck is a fact about
 * the past that transfer cannot revoke, and neither authorship nor sight is
 * power over the object.
 *
 * The line follows from `created_by` being create-only by construction
 * (server/storage/presentations/index.js): a creator-inclusive grant is one
 * nothing can ever take away, which is exactly wrong for a power that is meant
 * to be transferable. See docs/reference/permission-model.md.
 */

import { sandboxEnabled } from '../../config/sandbox.js';
import { isMultiOrgEnabled } from '../../config/features.js';
import {
  canComment,
  canWrite,
  canManage,
} from '../../../shared/constants/permissions.js';
import {
  hasIdentity,
  isOwner,
  isOwnerOrCreator,
} from '../../../shared/identity-match.js';

/**
 * Normalize presentation visibility to either 'organization' or 'private'.
 */
export function normalizePresentationVisibility(visibility) {
  return visibility === 'organization' ? 'organization' : 'private';
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
 * This gates the `visibility: 'organization'` grant, which is the one grant that rests
 * on "we are in the same organization" rather than on an explicit relation to the
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
 * and cost stay identical to before this check existed. In multi-organization mode
 * an unknown organization on either side is refused rather than waved through:
 * a presentation shape that lost its organization must fail closed.
 *
 * @param {Object} [user] - Authenticated user, carrying `organizationId`
 * @param {Object} [pres] - Presentation, carrying `organizationId`
 * @returns {boolean}
 */
export function isSameOrganization(user, pres) {
  if (!isMultiOrgEnabled()) return true;
  const userOrg = user?.organizationId;
  const presOrg = pres?.organizationId;
  if (!userOrg || !presOrg) return false;
  return userOrg === presOrg;
}

/**
 * Check if a user can read a presentation.
 */
export function canReadPresentation({
  user,
  pres,
  collaboratorPermission,
} = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  const visibility = normalizePresentationVisibility(pres?.visibility);
  if (!hasIdentity(user)) return false;
  if (visibility === 'organization' && isSameOrganization(user, pres))
    return true;

  // Owner or creator can read
  if (isOwnerOrCreator(user, pres)) return true;

  // Collaborator with any permission can read
  if (collaboratorPermission) return true;

  return false;
}

/**
 * Check if a user can write/edit a presentation.
 */
export function canWritePresentation({
  user,
  pres,
  collaboratorPermission,
} = {}) {
  if (isUnrestricted(user)) return true;
  // Sandbox stance: organization-visible decks are curated seed decks and must be read-only for guests.
  const visibility = normalizePresentationVisibility(pres?.visibility);
  if (sandboxEnabled() && visibility === 'organization') return false;

  // The owner can write. Not the creator: writing is power over the object, and
  // a transfer that cannot take it away is not a transfer (D49).
  if (!hasIdentity(user)) return false;
  if (isOwner(user, pres)) return true;

  // View-only presentations are read-only for non-owners
  if (pres?.isViewOnly) return false;

  // Organization-visible presentations: any user of that same organization can write
  if (visibility === 'organization' && isSameOrganization(user, pres))
    return true;

  // Collaborator with edit or admin permission can write
  if (canWrite(collaboratorPermission)) return true;

  return false;
}

/**
 * Check if a user can delete a presentation.
 */
export function canDeletePresentation({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  // Only the owner can delete — not the creator, and not a collaborator at any
  // permission (D49).
  if (!hasIdentity(user)) return false;
  return isOwner(user, pres);
}

/**
 * Check if a user can change presentation visibility.
 */
export function canChangePresentationVisibility({
  user,
  pres,
  nextVisibility,
} = {}) {
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;

  const from = normalizePresentationVisibility(pres?.visibility);
  const to = normalizePresentationVisibility(nextVisibility);
  if (from === to) return true;

  // Admins can always change visibility
  if (user?.isAdmin) return true;

  // Sandbox stance: prevent user-to-user sharing
  if (sandboxEnabled()) return false;

  // Phase 1: allow private -> organization by the owner only (D49). Widening
  // who may see a deck is power over the object, not an authorship fact.
  if (from === 'private' && to === 'organization') {
    return isOwner(user, pres);
  }

  // Organization -> private is intentionally not supported for non-admin in Phase 1.
  return false;
}

/**
 * Check if a user can transfer ownership of a presentation.
 *
 * The **owner** stamp alone, plus the auth-off operator — not the creator
 * (D43). Transfer is the act of ceasing to hold the deck, so the grant that
 * authorizes it has to be one the act can take away. `created_by` is
 * create-only by construction (server/storage/presentations/index.js), so a
 * creator-inclusive check would leave the person who made a deck able to take
 * it straight back forever, whatever they agreed to when they handed it over.
 *
 * D49 extended the same reasoning to write, delete, visibility and
 * collaborator management. What the creator stamp still carries is authorship
 * (slide locks) and comment moderation, which read the pair — see
 * docs/reference/permission-model.md.
 */
export function canTransferOwnership({ user, pres } = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;
  return isOwner(user, pres);
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
 * Allowed for: the owner, or a collaborator with 'admin' permission — not the
 * creator (D49). Handing out access to a deck is power over it.
 */
export function canManageCollaborators({
  user,
  pres,
  collaboratorPermission,
} = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;
  if (isOwner(user, pres)) return true;

  // Collaborator with admin permission can manage collaborators
  if (canManage(collaboratorPermission)) return true;

  return false;
}

/**
 * Check if a user can comment on a presentation.
 */
export function canCommentOnPresentation({
  user,
  pres,
  collaboratorPermission,
} = {}) {
  if (isUnrestricted(user)) return true;
  if (!pres || typeof pres !== 'object') return false;
  if (!hasIdentity(user)) return false;

  // Owner/creator can always comment
  if (isOwnerOrCreator(user, pres)) return true;

  // Organization-visible presentations: any user of that same organization can comment
  const visibility = normalizePresentationVisibility(pres?.visibility);
  if (visibility === 'organization' && isSameOrganization(user, pres))
    return true;

  // Collaborator with comment or edit permission can comment
  if (canComment(collaboratorPermission)) return true;

  return false;
}

/**
 * Get the effective permission level for a user on a presentation.
 * Used by the client to determine which UI to show (editor vs viewer).
 * @returns {'edit' | 'comment' | 'view'}
 */
export function getEffectivePermission({
  user,
  pres,
  collaboratorPermission,
} = {}) {
  if (isUnrestricted(user)) return 'edit';
  if (!pres || typeof pres !== 'object') return 'view';

  if (!hasIdentity(user)) return 'view';

  // The owner always has edit permission. Not the creator: this function is the
  // read-side mirror of canWritePresentation (it picks editor-vs-viewer UI), so
  // a creator-inclusive answer here would open an editor whose every save the
  // server refuses. A previous owner kept as a collaborator still resolves to
  // their collaborator permission below, which is what the transfer promises.
  if (isOwner(user, pres)) return 'edit';

  // Organization-visible presentations handling
  const visibility = normalizePresentationVisibility(pres?.visibility);
  if (visibility === 'organization' && isSameOrganization(user, pres)) {
    // View-only presentations allow commenting but not editing
    if (pres?.isViewOnly) return 'comment';
    // Regular organization-visible presentations give edit to all users of that organization
    return 'edit';
  }

  // Fall back to collaborator permission, or 'view' if none
  return collaboratorPermission || 'view';
}
