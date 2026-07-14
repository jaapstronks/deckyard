/**
 * Share link authorization functions.
 */

import { canRead, canComment, canWrite, isValidPermission } from '../../../shared/constants/permissions.js';

/**
 * Check if a share link grants read access.
 * All share link permissions (view, comment, edit) allow reading.
 * @param {Object} shareLink - The validated share link object
 * @returns {boolean}
 */
export function canReadWithShareLink(shareLink) {
  if (!shareLink || typeof shareLink !== 'object') return false;
  return canRead(shareLink.permission);
}

/**
 * Check if a share link grants comment access.
 * Only 'comment' and 'edit' permissions allow commenting.
 * @param {Object} shareLink - The validated share link object
 * @returns {boolean}
 */
export function canCommentWithShareLink(shareLink) {
  if (!shareLink || typeof shareLink !== 'object') return false;
  return canComment(shareLink.permission);
}

/**
 * Check if a share link grants write/edit access.
 * Only 'edit' permission allows writing.
 * @param {Object} shareLink - The validated share link object
 * @returns {boolean}
 */
export function canWriteWithShareLink(shareLink) {
  if (!shareLink || typeof shareLink !== 'object') return false;
  return canWrite(shareLink.permission);
}

/**
 * Get the effective permission level from a share link.
 * Returns null if the share link is invalid.
 * @param {Object} shareLink - The validated share link object
 * @returns {'view' | 'comment' | 'edit' | null}
 */
export function getShareLinkPermission(shareLink) {
  if (!shareLink || typeof shareLink !== 'object') return null;
  if (isValidPermission(shareLink.permission)) {
    return shareLink.permission;
  }
  return null;
}