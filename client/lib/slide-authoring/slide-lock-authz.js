/**
 * Slide locking authorization helpers for the client.
 * These complement the server-side validation in presentation-authz.
 */

/**
 * Normalize email to lowercase for comparison.
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Check if a user is the author of a presentation.
 * Authors are: owner, creator, or admin.
 * Authors can lock/unlock slides to prevent editing by collaborators.
 *
 * @param {Object} user - The user object with email and isAdmin
 * @param {Object} pres - The presentation object with ownerEmail and createdBy
 * @returns {boolean} True if user is an author
 */
export function isPresentationAuthor(user, pres) {
  if (!pres || typeof pres !== 'object') return false;
  if (user?.isAdmin) return true;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);
  return (owner && owner === userEmail) || (createdBy && createdBy === userEmail);
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
