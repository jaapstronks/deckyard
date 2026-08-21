/**
 * Share link authorization functions.
 */

import { canComment } from '../../../shared/constants/permissions.js';

/**
 * Check if a share link grants comment access.
 * Only 'comment' and 'edit' permissions allow commenting.
 *
 * Reads `permission` and nothing else: a revoked or expired link still answers
 * "yes" here. Refusing those is the validation layer's job (`validateShareLink`),
 * so a caller that skips validation gets no protection from this decider.
 * @param {Object} shareLink - The validated share link object
 * @returns {boolean}
 */
export function canCommentWithShareLink(shareLink) {
  if (!shareLink || typeof shareLink !== 'object') return false;
  return canComment(shareLink.permission);
}
