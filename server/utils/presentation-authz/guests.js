/**
 * Guest authorization functions.
 */

import { canComment } from '../../../shared/constants/permissions.js';

/**
 * Check if a guest can comment via their share link.
 * @param {Object} options
 * @param {Object} options.guest - The guest object from getGuestBySessionToken
 * @param {Object} options.shareLink - The share link object
 * @param {string} options.presentationId - The presentation ID being commented on
 * @returns {boolean}
 */
export function canGuestComment({ guest, shareLink, presentationId } = {}) {
  if (!guest || !shareLink) return false;

  // Guest must be verified
  if (!guest.verifiedAt) return false;

  // Share link must match the presentation
  if (shareLink.presentationId !== presentationId) return false;

  // Share link must have comment or edit permission
  if (!canComment(shareLink.permission)) return false;

  // Share link must not be revoked
  if (shareLink.revokedAt) return false;

  // Share link must not be expired
  if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date())
    return false;

  return true;
}

/**
 * Check if a guest can edit their own comment.
 *
 * A guest has no `users` row, so their identity is the `share_link_guests` row
 * they verified an address against — and that row's id is what a comment they
 * wrote carries (`authorGuestId`, migration 079). Comparing the addresses, as
 * this did before D22, meant the comment payload had to hand one out.
 *
 * @param {Object} options
 * @param {Object} options.guest - The guest object
 * @param {Object} options.comment - The comment object
 * @returns {boolean}
 */
export function canGuestEditComment({ guest, comment } = {}) {
  if (!guest?.id || !comment?.authorGuestId) return false;
  return guest.id === comment.authorGuestId;
}

/**
 * Check if a guest can delete their own comment.
 * Same as edit - only comment author can delete.
 */
export function canGuestDeleteComment({ guest, comment } = {}) {
  return canGuestEditComment({ guest, comment });
}
