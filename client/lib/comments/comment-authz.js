/**
 * Shared authorization utilities for comments.
 *
 * Advisory only: these decide which affordance the UI offers. Every operation
 * is authorized again on the server, by the same rule — deck ownership through
 * {@link isOwnerOrCreator} in shared/identity-match.js, which keys on the
 * stable `users.id` and on nothing else.
 */

import { isOwnerOrCreator } from '../../../shared/identity-match.js';

/**
 * Check if the user is the presentation owner (can resolve/reopen comments).
 * @param {Object} user - Current user object (from /api/auth/me, carrying `id`)
 * @param {Object} pres - Presentation object (carrying `ownerId` and the
 *   `createdBy` display pair)
 * @returns {boolean} True if user is owner or admin
 */
export function isCommentOwner(user, pres) {
  if (!user) return false;
  return Boolean(user.isAdmin) || isOwnerOrCreator(user, pres);
}

/**
 * Check if the user is the author of a comment (can delete).
 *
 * Comment authorship still compares emails: a comment row carries
 * `author_email` and no author id, so there is no stable key to compare yet.
 * That is the absence of a key, not a second one — same seam as the server's
 * canEditComment.
 *
 * @param {Object} user - Current user object
 * @param {Object} comment - Comment object
 * @returns {boolean} True if user is author or admin
 */
export function isCommentAuthor(user, comment) {
  if (!user || !comment) return false;
  const userEmail = (user.email || '').toLowerCase();
  const authorEmail = (comment.authorEmail || '').toLowerCase();
  return user.isAdmin || (!!userEmail && userEmail === authorEmail);
}

/**
 * Check if a guest is the author of a comment (for share-viewer context).
 *
 * Guests have no user record at all — a share-link guest is identified by the
 * email they gave — so this is email-keyed by nature.
 *
 * @param {Object} guestSession - Guest session object
 * @param {Object} comment - Comment object
 * @returns {boolean} True if guest is author
 */
export function isGuestCommentAuthor(guestSession, comment) {
  if (!guestSession || !comment) return false;
  const guestEmail = (guestSession.email || '').toLowerCase();
  const authorEmail = (comment.authorEmail || '').toLowerCase();
  return !!guestEmail && guestEmail === authorEmail;
}
