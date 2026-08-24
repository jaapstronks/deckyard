/**
 * Shared authorization utilities for comments.
 *
 * Advisory only: these decide which affordance the UI offers. Every operation
 * is authorized again on the server, by the same rule — deck ownership through
 * {@link isOwnerOrCreator} in shared/identity-match.js, which keys on the
 * stable `users.id` and on nothing else.
 */

import {
  isOwnerOrCreator,
  matchesIdentity,
} from '../../../shared/identity-match.js';
import { isOrganizationAdmin } from '../user/organization-role.js';

/**
 * Check if the user is the presentation owner (can resolve/reopen comments).
 * @param {Object} user - Current user object (from /api/auth/me, carrying `id`)
 * @param {Object} pres - Presentation object (carrying `ownerId` and the
 *   `createdBy` display pair)
 * @returns {boolean} True if user is owner or admin
 */
export function isCommentOwner(user, pres) {
  if (!user) return false;
  return isOrganizationAdmin(user) || isOwnerOrCreator(user, pres);
}

/**
 * Check if the user is the author of a comment (can delete).
 *
 * Authorship is the comment's `author.id` — a `users.id` since migration 079,
 * and the same key the server's canEditComment compares.
 *
 * @param {Object} user - Current user object
 * @param {Object} comment - Comment object
 * @returns {boolean} True if user is author or admin
 */
export function isCommentAuthor(user, comment) {
  if (!user || !comment) return false;
  return (
    isOrganizationAdmin(user) ||
    matchesIdentity(user, { userId: comment.author?.id })
  );
}

/**
 * Check if a guest is the author of a comment (for share-viewer context).
 *
 * A guest has no user record at all, so their identity is the
 * `share_link_guests` row behind their session — and a comment they wrote
 * carries that row's id (`authorGuestId`, migration 079). Mirrors the server's
 * canGuestEditComment.
 *
 * @param {Object} guestSession - Guest session object (carrying `id`)
 * @param {Object} comment - Comment object
 * @returns {boolean} True if guest is author
 */
export function isGuestCommentAuthor(guestSession, comment) {
  if (!guestSession?.id || !comment?.authorGuestId) return false;
  return guestSession.id === comment.authorGuestId;
}
