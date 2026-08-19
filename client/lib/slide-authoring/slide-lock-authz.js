/**
 * Slide locking authorization helpers for the client.
 *
 * Advisory only: these complement the server-side enforcement in
 * presentation-authz, on the same rule — deck ownership through
 * {@link isOwnerOrCreator} in shared/identity-match.js, which keys on the
 * stable `users.id` and on nothing else.
 */

import { isOwnerOrCreator } from '../../../shared/identity-match.js';

/**
 * Check if a user is the author of a presentation.
 * Authors are: owner, creator, or admin.
 * Authors can lock/unlock slides to prevent editing by collaborators.
 *
 * @param {Object} user - The user object with id and isAdmin
 * @param {Object} pres - The presentation, with ownerId/createdById
 * @returns {boolean} True if user is an author
 */
export function isPresentationAuthor(user, pres) {
  if (!pres || typeof pres !== 'object') return false;
  if (user?.isAdmin) return true;
  return isOwnerOrCreator(user, pres);
}

/**
 * Check if a slide is locked for a specific user.
 * Returns true if the slide is author-locked AND the user is NOT an author.
 *
 * @param {Object} slide - The slide object with lockedByAuthor flag
 * @param {Object} user - The user object
 * @param {Object} pres - The presentation object
 * @returns {boolean} True if slide editing is blocked for this user
 */
export function isSlideLockedForUser(slide, user, pres) {
  if (!slide?.lockedByAuthor) return false;
  // Authors can always edit locked slides
  if (isPresentationAuthor(user, pres)) return false;
  return true;
}
