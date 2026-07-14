/**
 * Action route handlers for presentation comments.
 * Includes resolve, reopen, dismiss, and apply operations.
 */

import { getPresentation as getFullPresentation, updatePresentation } from '../../../storage/presentations.js';
import {
  methodNotAllowed,
  serveJson,
  unauthorized,
  badRequest,
} from '../../../utils/http.js';
import { canResolveComment } from '../../../utils/presentation-authz.js';
import {
  getComment,
  resolveComment,
  reopenComment,
  dismissComment,
} from '../../../storage/presentation-comments.js';
import {
  recordCommentResolved,
  recordCommentReopened,
} from '../../../services/activity-events.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { getCtx, broadcastCommentCounts } from './comments-shared.js';

/**
 * Resolve a comment.
 * POST /api/presentations/:id/comments/:commentId/resolve
 */
export async function handlePresentationCommentResolve(
  { repoRoot, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const comment = await getComment(commentId, ctx);

  if (!comment || comment.presentationId !== id) {
    return serveJson(res, 404, { ok: false, error: 'Comment not found' });
  }

  // Only owner/admin can resolve
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    return unauthorized(res);
  }

  const result = await resolveComment(commentId, { email: authedUser?.email }, ctx);

  if (!result.ok) {
    return serveJson(res, 400, result);
  }

  // Record activity event (non-blocking)
  void recordCommentResolved({
    comment: result.comment,
    presentation: pres,
    actor: authedUser,
    ctx,
  });

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.RESOLVED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(id, ctx);

  serveJson(res, 200, result);
  return true;
}

/**
 * Reopen a resolved comment.
 * POST /api/presentations/:id/comments/:commentId/reopen
 */
export async function handlePresentationCommentReopen(
  { repoRoot, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const comment = await getComment(commentId, ctx);

  if (!comment || comment.presentationId !== id) {
    return serveJson(res, 404, { ok: false, error: 'Comment not found' });
  }

  // Only owner/admin can reopen
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    return unauthorized(res);
  }

  const result = await reopenComment(commentId, ctx);

  if (!result.ok) {
    return serveJson(res, 400, result);
  }

  // Record activity event (non-blocking)
  void recordCommentReopened({
    comment: result.comment,
    presentation: pres,
    actor: authedUser,
    ctx,
  });

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.REOPENED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(id, ctx);

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
  { repoRoot, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const comment = await getComment(commentId, ctx);

  if (!comment || comment.presentationId !== id) {
    return serveJson(res, 404, { ok: false, error: 'Comment not found' });
  }

  // Only owner/admin can dismiss (same as resolve)
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    return unauthorized(res);
  }

  const result = await dismissComment(commentId, { email: authedUser?.email }, ctx);

  if (!result.ok) {
    return serveJson(res, 400, result);
  }

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.RESOLVED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(id, ctx);

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
  { repoRoot, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const comment = await getComment(commentId, ctx);

  if (!comment || comment.presentationId !== id) {
    return serveJson(res, 404, { ok: false, error: 'Comment not found' });
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
  const fullPres = await getFullPresentation(repoRoot, id);
  if (!fullPres) return serveJson(res, 404, { ok: false, error: 'Presentation not found' });

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
  await updatePresentation(repoRoot, id, fullPres, ctx);

  // Mark the suggestion as resolved
  const resolveResult = await resolveComment(commentId, { email: authedUser?.email }, ctx);

  // Broadcast comment update
  if (resolveResult.ok) {
    void broadcastToPresentation(id, CommentEventTypes.RESOLVED, {
      comment: resolveResult.comment,
    });
  }
  void broadcastCommentCounts(id, ctx);

  serveJson(res, 200, {
    ok: true,
    newSlideId,
    originalSlideId: comment.slideId,
    originalSlideIndex,
    newSlideIndex: originalSlideIndex + 1,
  });
  return true;
}