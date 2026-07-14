/**
 * Shared authorization utilities for comments.
 */

/**
 * Check if the user is the presentation owner (can resolve/reopen comments).
 * @param {Object} user - Current user object
 * @param {Object} pres - Presentation object
 * @returns {boolean} True if user is owner or admin
 */
export function isCommentOwner(user, pres) {
  if (!user) return false;
  const userEmail = (user.email || '').toLowerCase();
  const ownerEmail = (pres?.ownerEmail || '').toLowerCase();
  const createdBy = (pres?.createdBy || '').toLowerCase();
  return user.isAdmin || userEmail === ownerEmail || userEmail === createdBy;
}

/**
 * Check if the user is the author of a comment (can delete).
 * @param {Object} user - Current user object
 * @param {Object} comment - Comment object
 * @returns {boolean} True if user is author or admin
 */
export function isCommentAuthor(user, comment) {
  if (!user || !comment) return false;
  const userEmail = (user.email || '').toLowerCase();
  const authorEmail = (comment.authorEmail || '').toLowerCase();
  return user.isAdmin || userEmail === authorEmail;
}

/**
 * Check if a guest is the author of a comment (for share-viewer context).
 * @param {Object} guestSession - Guest session object
 * @param {Object} comment - Comment object
 * @returns {boolean} True if guest is author
 */
export function isGuestCommentAuthor(guestSession, comment) {
  if (!guestSession || !comment) return false;
  const guestEmail = (guestSession.email || '').toLowerCase();
  const authorEmail = (comment.authorEmail || '').toLowerCase();
  return guestEmail === authorEmail;
}