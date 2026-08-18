/**
 * Shared utilities for comment route handlers.
 */

import {
  getOpenCommentCount,
  getCommentCountsBySlide,
} from '../../../storage/presentations/comments.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';

/** Maximum length for comment body text */
export const MAX_COMMENT_LENGTH = 5000;

/**
 * Broadcast updated comment counts to all connected clients.
 * Called after any comment mutation (create/update/delete/resolve/reopen).
 */
export async function broadcastCommentCounts(presentationId, storageScope) {
  try {
    const counts = await getCommentCountsBySlide(storageScope, presentationId);
    const total = await getOpenCommentCount(storageScope, presentationId);
    broadcastToPresentation(presentationId, CommentEventTypes.COUNTS_CHANGED, {
      counts,
      total,
    });
  } catch {
    // Ignore broadcast errors
  }
}