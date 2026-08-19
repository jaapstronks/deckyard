/**
 * Comment authorization functions.
 *
 * Deck ownership is decided by {@link isOwnerOrCreator} (shared/identity-match.js),
 * which keys on `users.id`. Comment *authorship* is the exception and still
 * compares emails: `presentation_comments` carries `author_email` and no
 * author id column (migration 003), so there is no stable key to compare yet.
 * Giving comments one is its own migration, tracked in the identity-decoupling
 * brief; until then this is the absence of a key, not a second key.
 */

import { normalizeEmail } from '../normalize.js';
import {
  hasIdentity,
  isOwnerOrCreator,
} from '../../../shared/identity-match.js';

/**
 * Check if a user can resolve/reopen a comment.
 * Only admin or owner/creator of the presentation can resolve comments.
 */
export function canResolveComment({ user, pres } = {}) {
  if (user?.isAdmin) return true;
  if (!hasIdentity(user)) return false;
  return isOwnerOrCreator(user, pres);
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
  if (!hasIdentity(user)) return false;
  return isOwnerOrCreator(user, pres);
}
