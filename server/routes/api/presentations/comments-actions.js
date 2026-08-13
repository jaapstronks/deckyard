/**
 * Action route handlers for presentation comments.
 * Includes resolve, reopen, dismiss, and apply operations.
 */

import { getPresentation as getFullPresentation, updatePresentation } from '../../../storage/presentations/index.js';
import {
  methodNotAllowed,
  serveJson,
  unauthorized,
  badRequest,
  requireJsonBody,
  notFound,
  jsonError,
  getErrorStatus,
} from '../../../utils/http.js';
import { canResolveComment } from '../../../utils/presentation-authz.js';
import {
  getComment,
  resolveComment,
  reopenComment,
  dismissComment,
  markThreadsRead,
} from '../../../storage/presentation-comments.js';
import {
  recordCommentResolved,
  recordCommentReopened,
} from '../../../services/activity-events.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { withPresentationAuth, withPresentationReadAuth } from '../../../utils/route-middleware.js';
import { broadcastCommentCounts } from './comments-shared.js';

/**
 * Resolve a comment.
 * POST /api/presentations/:id/comments/:commentId/resolve
 */
export async function handlePresentationCommentResolve(
  { storageScope, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  // Only owner/admin can resolve
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    return unauthorized(res);
  }

  const result = await resolveComment(storageScope, commentId, { email: authedUser?.email });

  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason);
  }

  // Record activity event (non-blocking)
  void recordCommentResolved({
    comment: result.comment,
    presentation: pres,
    actor: authedUser,
    scope: storageScope,
  });

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.RESOLVED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(id, storageScope);

  serveJson(res, 200, result);
  return true;
}

/**
 * Reopen a resolved comment.
 * POST /api/presentations/:id/comments/:commentId/reopen
 */
export async function handlePresentationCommentReopen(
  { storageScope, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  // Only owner/admin can reopen
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    return unauthorized(res);
  }

  const result = await reopenComment(storageScope, commentId);

  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason);
  }

  // Record activity event (non-blocking)
  void recordCommentReopened({
    comment: result.comment,
    presentation: pres,
    actor: authedUser,
    scope: storageScope,
  });

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.REOPENED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(id, storageScope);

  serveJson(res, 200, result);
  return true;
}

/**
 * Dismiss an AI suggestion.
 * POST /api/presentations/:id/comments/:commentId/dismiss
 *
 * Different from resolve - used specifically for AI suggestions the user doesn't want to act on.
 */
export async function handlePresentationCommentDismiss(
  { storageScope, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  // Only owner/admin can dismiss (same as resolve)
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    return unauthorized(res);
  }

  const result = await dismissComment(storageScope, commentId, { email: authedUser?.email });

  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason);
  }

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.RESOLVED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(id, storageScope);

  serveJson(res, 200, result);
  return true;
}

/**
 * Apply an AI suggestion - create the proposed slide.
 * POST /api/presentations/:id/comments/:commentId/apply
 *
 * For suggestions with proposedSlide data, this creates a new slide
 * after the slide referenced by the comment's slideId.
 */
export async function handlePresentationCommentApply(
  { storageScope, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  // Only owner/admin can apply suggestions
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    return unauthorized(res);
  }

  // Verify comment has proposedSlide data
  if (!comment.proposedSlide || !comment.proposedSlide.type || !comment.proposedSlide.content) {
    return badRequest(res, 'This suggestion does not have a proposed slide');
  }

  // Get the full presentation to modify
  const fullPres = await getFullPresentation(storageScope, id);
  if (!fullPres) return notFound(res, 'Presentation not found');

  // Find the slide referenced by the comment
  const slides = fullPres.slides || [];
  const originalSlideIndex = slides.findIndex(s => s.id === comment.slideId);

  if (originalSlideIndex === -1) {
    return badRequest(res, 'Referenced slide not found');
  }

  // Create the new slide with a unique ID
  const newSlideId = crypto.randomUUID();
  const newSlide = {
    id: newSlideId,
    type: comment.proposedSlide.type,
    content: comment.proposedSlide.content,
  };

  // Insert the new slide after the original slide
  const updatedSlides = [...slides];
  updatedSlides.splice(originalSlideIndex + 1, 0, newSlide);

  // Update the presentation
  fullPres.slides = updatedSlides;
  await updatePresentation(storageScope, id, fullPres, storageScope);

  // Mark the suggestion as resolved
  const resolveResult = await resolveComment(storageScope, commentId, { email: authedUser?.email });

  // Broadcast comment update
  if (resolveResult.ok) {
    void broadcastToPresentation(id, CommentEventTypes.RESOLVED, {
      comment: resolveResult.comment,
    });
  }
  void broadcastCommentCounts(id, storageScope);

  serveJson(res, 200, {
    ok: true,
    newSlideId,
    originalSlideId: comment.slideId,
    originalSlideIndex,
    newSlideIndex: originalSlideIndex + 1,
  });
  return true;
}
/**
 * Mark comment threads as read for the current user (batch).
 * POST /api/presentations/:id/comments/mark-read
 * Body: { commentIds: string[] }
 *
 * Personal read-state, not a thread status: nothing shared changes. Guests
 * have no account and therefore no read-state; their calls are a cheap no-op
 * so the client doesn't need a special guest path.
 */
export async function handlePresentationCommentsMarkRead(
  { storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { pres } = await withPresentationReadAuth({ storageScope, req, id, authedUser, res });
  if (!pres) return true;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const commentIds = jsonResult.body?.commentIds;
  if (!Array.isArray(commentIds)) {
    return badRequest(res, 'commentIds array is required');
  }
  if (commentIds.length > 500) {
    return badRequest(res, 'Too many commentIds (max 500)');
  }

  const result = await markThreadsRead(storageScope, id, commentIds);
  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason);
  }

  serveJson(res, 200, { ok: true, marked: result.marked });
  return true;
}
