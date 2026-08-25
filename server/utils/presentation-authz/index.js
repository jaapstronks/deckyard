/**
 * Presentation authorization — the seam over the domain-specific modules here:
 * - `share-links.js`: Share link permissions
 * - `presentations.js`: Core presentation permissions
 * - `comments.js`: Comment permissions
 * - `guests.js`: Guest permissions
 * - `actor-access.js`: Machine-client access (public API, MCP)
 * - `../../../shared/identity-match.js`: Who an actor is (keyed on `users.id`),
 *   shared with the client
 */

// Identity matching — the one place ownership stamps are compared
export {
  isOwner,
  isOwnerOrCreator,
  matchesIdentity,
  hasIdentity,
} from '../../../shared/identity-match.js';

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
} from './presentations.js';

// Share link permissions
export { canCommentWithShareLink } from './share-links.js';

// Comment permissions
export {
  canResolveComment,
  canEditComment,
  canDeleteComment,
} from './comments.js';

// Guest permissions
export {
  canGuestComment,
  canGuestEditComment,
  canGuestDeleteComment,
} from './guests.js';

// Actor-based access (machine clients: public API, MCP)
export {
  checkActorAccess,
  canActorAccessPresentation,
  canActorDeletePresentation,
  canActorResolveComment,
  checkActorCommentAccess,
  canActorCommentOnPresentation,
} from './actor-access.js';
