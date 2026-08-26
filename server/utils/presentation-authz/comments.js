/**
 * Comment authorization functions.
 *
 * Deck ownership is decided by {@link isOwnerOrCreator} (shared/identity-match.js),
 * which keys on `users.id`. Comment **authorship** is decided the same way
 * since migration 079 gave `presentation_comments` an `author_user_id`: no
 * address is compared here either.
 *
 * A share-link guest is the one author without a `users.id` — they have no
 * account and never will — so their comments are keyed on the guest row that
 * verified their address (`author_guest_id`), in guests.js.
 */

import {
  hasIdentity,
  isOwnerOrCreator,
  matchesIdentity,
} from '../../../shared/identity-match.js';
import { isOrganizationAdmin } from '../../../shared/organization-role.js';

/**
 * Check if a user can resolve/reopen a comment.
 * Only admin or owner/creator of the presentation can resolve comments.
 */
export function canResolveComment({ user, pres } = {}) {
  if (isOrganizationAdmin(user)) return true;
  if (!hasIdentity(user)) return false;
  return isOwnerOrCreator(user, pres);
}

/**
 * Check if a user can edit a comment.
 * Only the comment author or admin can edit.
 *
 * Authorship is the comment's `author.id` — a `users.id`, the same key every
 * other ownership decision uses (shared/identity-match.js). A comment written
 * by a share-link guest carries no user id and is theirs to edit through
 * {@link canGuestEditComment} instead.
 */
export function canEditComment({ user, comment } = {}) {
  if (isOrganizationAdmin(user)) return true;
  return matchesIdentity(user, { userId: comment?.author?.id });
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
