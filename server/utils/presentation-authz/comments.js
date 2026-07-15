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
 * The comment author or an admin can always delete. Additionally, the
 * presentation owner/creator can delete (moderate) any comment on their
 * own presentation, mirroring canResolveComment - so owners can clean up
 * AI suggestions, guest comments, and collaborator feedback.
 */
export function canDeleteComment({ user, pres, comment } = {}) {
  if (canEditComment({ user, comment })) return true;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  return (owner && owner === userEmail) || (createdBy && createdBy === userEmail);
}