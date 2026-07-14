/**
 * Comment authorization functions.
 */

import { normalizeEmail } from '../normalize.js';

/**
 * Check if a user can resolve/reopen a comment.
 * Only admin or owner/creator of the presentation can resolve comments.
 */
export function canResolveComment({ user, pres, comment } = {}) {
  if (user?.isAdmin) return true;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  return (owner && owner === userEmail) || (createdBy && createdBy === userEmail);
}

/**
 * Check if a user can edit a comment.
 * Only the comment author or admin can edit.
 */
export function canEditComment({ user, comment } = {}) {
  if (user?.isAdmin) return true;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const authorEmail = normalizeEmail(comment?.authorEmail);
  return authorEmail && authorEmail === userEmail;
}

/**
 * Check if a user can delete a comment.
 * Same as edit - only author or admin can delete.
 */
export function canDeleteComment({ user, comment } = {}) {
  return canEditComment({ user, comment });
}