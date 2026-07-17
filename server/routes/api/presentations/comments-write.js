/**
 * Write route handlers for presentation comments.
 * Includes create, update, and delete operations.
 */

import { getPresentation } from '../../../storage/presentations.js';
import {
  json,
  methodNotAllowed,
  serveJson,
  unauthorized,
  badRequest,
} from '../../../utils/http.js';
import {
  canReadPresentation,
  canEditComment,
  canDeleteComment,
  canGuestComment,
  canGuestEditComment,
  canGuestDeleteComment,
} from '../../../utils/presentation-authz.js';
import {
  getComment,
  createComment,
  updateComment,
  deleteComment,
} from '../../../storage/presentation-comments.js';
import {
  recordCommentCreated,
} from '../../../services/activity-events.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { getGuestFromRequest, withPresentationCommentAuth } from '../../../utils/route-middleware.js';
import { notifyCommentCreated } from '../../../services/comment-notifications.js';
import { getCtx, MAX_COMMENT_LENGTH, broadcastCommentCounts } from './comments-shared.js';

/**
 * Check if a user (authenticated or guest) can edit a comment.
 */
async function checkCommentEditAccess({ req, authedUser, pres, comment }) {
  if (canReadPresentation({ user: authedUser, pres })) {
    return canEditComment({ user: authedUser, comment });
  }
  const guestInfo = await getGuestFromRequest(req);
  if (guestInfo && guestInfo.shareLink.presentationId === pres.id) {
    return canGuestEditComment({ guest: guestInfo.guest, comment });
  }
  return false;
}

/**
 * Check if a user (authenticated or guest) can delete a comment.
 */
async function checkCommentDeleteAccess({ req, authedUser, pres, comment }) {
  if (canReadPresentation({ user: authedUser, pres })) {
    return canDeleteComment({ user: authedUser, pres, comment });
  }
  const guestInfo = await getGuestFromRequest(req);
  if (guestInfo && guestInfo.shareLink.presentationId === pres.id) {
    return canGuestDeleteComment({ guest: guestInfo.guest, comment });
  }
  return false;
}

/**
 * Create a new comment.
 * POST /api/presentations/:id/comments
 * Body: { body, slideId?, parentId? }
 *
 * Supports both authenticated users and verified guests with share link access.
 */
export async function handlePresentationCommentsCreate(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { pres, guestInfo: foundGuestInfo } = await withPresentationCommentAuth({ repoRoot, req, id, authedUser, res });
  if (!pres) return true;

  // Determine commenter identity
  let commenterEmail = authedUser?.email;
  let commenterName = authedUser?.name;
  let isGuest = false;
  let guestInfo = null;

  if (authedUser?.email && !foundGuestInfo) {
    // Authenticated user with comment access - use their info
    commenterEmail = authedUser?.email;
    commenterName = authedUser?.name;
  } else if (foundGuestInfo) {
    // Guest session found - verify they can comment
    guestInfo = foundGuestInfo;

    if (!canGuestComment({
      guest: guestInfo.guest,
      shareLink: guestInfo.shareLink,
      presentationId: id,
    })) {
      return unauthorized(res);
    }

    commenterEmail = guestInfo.guest.email;
    commenterName = guestInfo.guest.name;
    isGuest = true;
  }

  const body = await json(req);
  if (!body?.body || typeof body.body !== 'string' || !body.body.trim()) {
    return badRequest(res, 'Comment body is required');
  }

  // Validate comment body length
  if (body.body.length > MAX_COMMENT_LENGTH) {
    return badRequest(res, `Comment must be ${MAX_COMMENT_LENGTH} characters or less`);
  }

  const ctx = getCtx(authedUser);

  // Get parent comment if this is a reply (for notification recipient)
  let parentComment = null;
  if (body.parentId) {
    parentComment = await getComment(body.parentId, ctx);
  }

  const result = await createComment(id, {
    email: commenterEmail,
    name: commenterName,
    body: body.body,
    slideId: body.slideId || null,
    parentId: body.parentId || null,
    positionX: body.positionX,
    positionY: body.positionY,
  }, ctx);

  if (!result.ok) {
    return serveJson(res, 400, result);
  }

  // Fire notifications (non-blocking)
  // For guests, create a mock authedUser object for notifications
  const notificationUser = isGuest
    ? { email: commenterEmail, name: commenterName }
    : authedUser;

  void notifyCommentCreated(repoRoot, req, {
    presentation: pres,
    comment: result.comment,
    parentComment,
    actor: notificationUser,
    ctx,
  });

  // Record activity event (non-blocking)
  void recordCommentCreated({
    comment: result.comment,
    presentation: pres,
    actor: notificationUser,
    isGuest,
    ctx,
  });

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.CREATED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(id, ctx);

  serveJson(res, 201, result);
  return true;
}

/**
 * Update a comment's body.
 * PUT /api/presentations/:id/comments/:commentId
 * Body: { body }
 *
 * Supports both authenticated users and verified guests editing their own comments.
 */
export async function handlePresentationCommentUpdate(
  { repoRoot, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return serveJson(res, 404, { ok: false, error: 'Presentation not found' });

  const ctx = getCtx(authedUser);
  const comment = await getComment(commentId, ctx);

  if (!comment || comment.presentationId !== id) {
    return serveJson(res, 404, { ok: false, error: 'Comment not found' });
  }

  const canEdit = await checkCommentEditAccess({ req, authedUser, pres, comment });
  if (!canEdit) {
    return unauthorized(res);
  }

  const body = await json(req);
  if (!body?.body || typeof body.body !== 'string' || !body.body.trim()) {
    return badRequest(res, 'Comment body is required');
  }

  // Validate comment body length
  if (body.body.length > MAX_COMMENT_LENGTH) {
    return badRequest(res, `Comment must be ${MAX_COMMENT_LENGTH} characters or less`);
  }

  const result = await updateComment(commentId, { body: body.body }, ctx);

  if (!result.ok) {
    return serveJson(res, 400, result);
  }

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.UPDATED, {
    comment: result.comment,
  });

  serveJson(res, 200, result);
  return true;
}

/**
 * Delete a comment.
 * DELETE /api/presentations/:id/comments/:commentId
 *
 * Supports both authenticated users and verified guests deleting their own comments.
 */
export async function handlePresentationCommentDelete(
  { repoRoot, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return serveJson(res, 404, { ok: false, error: 'Presentation not found' });

  const ctx = getCtx(authedUser);
  const comment = await getComment(commentId, ctx);

  if (!comment || comment.presentationId !== id) {
    return serveJson(res, 404, { ok: false, error: 'Comment not found' });
  }

  const canDelete = await checkCommentDeleteAccess({ req, authedUser, pres, comment });
  if (!canDelete) {
    return unauthorized(res);
  }

  const result = await deleteComment(commentId, ctx);

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.DELETED, {
    commentId,
    slideId: comment.slideId,
  });
  void broadcastCommentCounts(id, ctx);

  serveJson(res, 200, result);
  return true;
}