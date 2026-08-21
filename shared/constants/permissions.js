/**
 * Permission constants for presentations and share links.
 * Centralizes permission-related values to ensure consistency.
 */

/**
 * Permission levels for presentations.
 * - VIEW: Read-only access
 * - COMMENT: Can read and add comments
 * - EDIT: Full editing access
 * - ADMIN: Can edit AND manage collaborators (without being the owner)
 */
export const PERMISSIONS = {
  VIEW: 'view',
  COMMENT: 'comment',
  EDIT: 'edit',
  ADMIN: 'admin',
};

/**
 * All permission levels as an array.
 * Use when checking if a permission is valid.
 */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/**
 * Permission levels a **share link** may carry.
 *
 * A link is a URL anyone can hold, so it never grants collaborator management:
 * ADMIN is deliberately absent. This is the subset `createShareLink` validates
 * against, and the reason the share-link deciders can lean on the ladder below
 * without ever meeting an 'admin' link.
 */
export const SHARE_LINK_PERMISSIONS = [
  PERMISSIONS.VIEW,
  PERMISSIONS.COMMENT,
  PERMISSIONS.EDIT,
];

/**
 * Permissions that allow reading (all of them).
 */
const READ_PERMISSIONS = [
  PERMISSIONS.VIEW,
  PERMISSIONS.COMMENT,
  PERMISSIONS.EDIT,
  PERMISSIONS.ADMIN,
];

/**
 * Permissions that allow commenting.
 */
const COMMENT_PERMISSIONS = [
  PERMISSIONS.COMMENT,
  PERMISSIONS.EDIT,
  PERMISSIONS.ADMIN,
];

/**
 * Permissions that allow editing/writing.
 */
const WRITE_PERMISSIONS = [PERMISSIONS.EDIT, PERMISSIONS.ADMIN];

/**
 * Permissions that allow managing collaborators.
 */
const MANAGE_PERMISSIONS = [PERMISSIONS.ADMIN];

/**
 * Check if a permission is valid.
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export function isValidPermission(permission) {
  return ALL_PERMISSIONS.includes(permission);
}

/**
 * Check if a permission is one a share link may carry (never 'admin').
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export function isValidShareLinkPermission(permission) {
  return SHARE_LINK_PERMISSIONS.includes(permission);
}

/**
 * Check if a permission allows reading.
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export function canRead(permission) {
  return READ_PERMISSIONS.includes(permission);
}

/**
 * Check if a permission allows commenting.
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export function canComment(permission) {
  return COMMENT_PERMISSIONS.includes(permission);
}

/**
 * Check if a permission allows writing/editing.
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export function canWrite(permission) {
  return WRITE_PERMISSIONS.includes(permission);
}

/**
 * Check if a permission allows managing collaborators.
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export function canManage(permission) {
  return MANAGE_PERMISSIONS.includes(permission);
}
