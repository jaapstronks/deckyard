/**
 * Write route handlers for presentation comments.
 * Includes create, update, and delete operations.
 */

import { getPresentation } from '../../../storage/presentations/index.js';
import {
  methodNotAllowed,
  serveJson,
  unauthorized,
  badRequest,
  notFound,
  requireJsonBody,
  jsonError,
  getErrorStatus,
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
} from '../../../storage/presentations/comments.js';
import {
  recordCommentCreated,
} from '../../../services/activity-events.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { getGuestFromRequest, withPresentationCommentAuth } from '../../../utils/route-middleware.js';
import { notifyCommentCreated, notifyMentionsAdded } from '../../../services/comment-notifications.js';
import { MAX_COMMENT_LENGTH, broadcastCommentCounts } from './comments-shared.js';
import { getString } from '../../../utils/request-validators.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('comments-write');

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
  { repoRoot, storageScope, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { pres, guestInfo: foundGuestInfo } = await withPresentationCommentAuth({ storageScope, req, id, authedUser, res });
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

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if (!getString(body, 'body').trim()) {
    return badRequest(res, 'Comment body is required');
  }

  // Validate comment body length
  if (body.body.length > MAX_COMMENT_LENGTH) {
    return badRequest(res, `Comment must be ${MAX_COMMENT_LENGTH} characters or less`);
  }


  // Get parent comment if this is a reply (for notification recipient)
  let parentComment = null;
  if (body.parentId) {
    parentComment = await getComment(storageScope, body.parentId);
  }

  const result = await createComment(storageScope, id, {
    email: commenterEmail,
    name: commenterName,
    body: body.body,
    slideId: body.slideId || null,
    parentId: body.parentId || null,
    positionX: body.positionX,
    positionY: body.positionY,
  });

  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason);
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
    scope: storageScope,
  });

  // Record activity event (non-blocking)
  void recordCommentCreated({
    comment: result.comment,
    presentation: pres,
    actor: notificationUser,
    isGuest,
    scope: storageScope,
  });

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.CREATED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(id, storageScope);

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
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);

  const pres = await getPresentation(storageScope, id);
  if (!pres) return notFound(res, 'Presentation not found');

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  const canEdit = await checkCommentEditAccess({ req, authedUser, pres, comment });
  if (!canEdit) {
    return unauthorized(res);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if (!getString(body, 'body').trim()) {
    return badRequest(res, 'Comment body is required');
  }

  // Validate comment body length
  if (body.body.length > MAX_COMMENT_LENGTH) {
    return badRequest(res, `Comment must be ${MAX_COMMENT_LENGTH} characters or less`);
  }

  const result = await updateComment(storageScope, commentId, { body: body.body });

  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason);
  }

  // A mention added by the edit notifies like a fresh mention (diffed
  // against the pre-edit list, so re-saving never re-notifies).
  void (async () => {
    const parentComment = result.comment?.parentId
      ? await getComment(storageScope, result.comment.parentId)
      : null;
    await notifyMentionsAdded(repoRoot, req, {
      presentation: pres,
      comment: result.comment,
      previousMentions: comment.mentions,
      parentComment,
      actor: authedUser || { email: comment.authorEmail, name: comment.authorName },
      scope: storageScope,
    });
  })().catch((e) => {
    // eslint-disable-next-line no-console
    log.warn('[comments] mention-on-edit notify failed:', e?.message || e);
  });

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
  { storageScope, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  const pres = await getPresentation(storageScope, id);
  if (!pres) return notFound(res, 'Presentation not found');

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  const canDelete = await checkCommentDeleteAccess({ req, authedUser, pres, comment });
  if (!canDelete) {
    return unauthorized(res);
  }

  const result = await deleteComment(storageScope, commentId);
  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason);
  }

  // Broadcast to all connected clients (non-blocking)
  void broadcastToPresentation(id, CommentEventTypes.DELETED, {
    commentId,
    slideId: comment.slideId,
  });
  void broadcastCommentCounts(id, storageScope);

  serveJson(res, 200, result);
  return true;
}