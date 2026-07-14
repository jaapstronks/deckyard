/**
 * Shared utilities for comment route handlers.
 */

import {
  getOpenCommentCount,
  getCommentCountsBySlide,
} from '../../../storage/presentation-comments.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { createRouteContext } from '../../../utils/context.js';

/** Maximum length for comment body text */
export const MAX_COMMENT_LENGTH = 5000;

/** Shorthand for creating route context */
export const getCtx = createRouteContext;

/**
 * Broadcast updated comment counts to all connected clients.
 * Called after any comment mutation (create/update/delete/resolve/reopen).
 */
export async function broadcastCommentCounts(presentationId, ctx) {
  try {
    const counts = await getCommentCountsBySlide(presentationId, ctx);
    const total = await getOpenCommentCount(presentationId, ctx);
    broadcastToPresentation(presentationId, CommentEventTypes.COUNTS_CHANGED, {
      counts,
      total,
    });
  } catch {
    // Ignore broadcast errors
  }
}