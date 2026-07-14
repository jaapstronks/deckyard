/**
 * Presentation authorization functions.
 *
 * This module re-exports all authorization functions from their domain-specific files:
 * - presentation-authz/share-links.js: Share link permissions
 * - presentation-authz/presentations.js: Core presentation permissions
 * - presentation-authz/comments.js: Comment permissions
 * - presentation-authz/guests.js: Guest permissions
 */

// Re-export permission constants for convenience
export {
  PERMISSIONS,
  canRead,
  canComment,
  canWrite,
  canManage,
  isValidPermission,
} from '../../shared/constants/permissions.js';

// Share link permissions
export {
  canReadWithShareLink,
  canCommentWithShareLink,
  canWriteWithShareLink,
  getShareLinkPermission,
} from './presentation-authz/share-links.js';

// Core presentation permissions
export {
  normalizePresentationScope,
  canReadPresentation,
  canWritePresentation,
  canDeletePresentation,
  canManageStarterKit,
  canChangePresentationScope,
  canClaimOwnership,
  canForceLockRelease,
  canTransferOwnership,
  canManageCollaborators,
  canCommentOnPresentation,
  getEffectivePermission,
  isPresentationAuthor,
} from './presentation-authz/presentations.js';

// Comment permissions
export {
  canResolveComment,
  canEditComment,
  canDeleteComment,
} from './presentation-authz/comments.js';

// Guest permissions
export {
  canGuestComment,
  canGuestEditComment,
  canGuestDeleteComment,
} from './presentation-authz/guests.js';