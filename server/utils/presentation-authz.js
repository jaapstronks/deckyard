/**
 * Presentation authorization functions.
 *
 * This module re-exports all authorization functions from their domain-specific files:
 * - presentation-authz/share-links.js: Share link permissions
 * - presentation-authz/presentations.js: Core presentation permissions
 * - presentation-authz/comments.js: Comment permissions
 * - presentation-authz/guests.js: Guest permissions
 * - shared/identity-match.js: Who an actor is (keyed on `users.id`), shared with the client
 */

// Identity matching — the one place ownership stamps are compared
export {
  isOwnerOrCreator,
  matchesIdentity,
  hasIdentity,
} from '../../shared/identity-match.js';

// Core presentation permissions
export {
  normalizePresentationVisibility,
  canReadPresentation,
  canWritePresentation,
  canDeletePresentation,
  canChangePresentationVisibility,
  canTransferOwnership,
  canManageCollaborators,
  canCommentOnPresentation,
  getEffectivePermission,
  isPresentationAuthor,
  isUnrestricted,
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

// Actor-based access (machine clients: public API, MCP)
export {
  checkActorAccess,
  canActorAccessPresentation,
  canActorDeletePresentation,
  canActorResolveComment,
  checkActorCommentAccess,
  canActorCommentOnPresentation,
} from './presentation-authz/actor-access.js';
