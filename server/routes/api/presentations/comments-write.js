/**
 * Write route handlers for presentation comments.
 * Includes create, update, and delete operations.
 */

import {
  badRequest,
  methodNotAllowed,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  forbidden,
} from '../../../utils/http.js';
import {
  canEditComment,
  canDeleteComment,
  canGuestEditComment,
  canGuestDeleteComment,
} from '../../../utils/presentation-authz/index.js';
import {
  getComment,
  getCommentAuthorEmail,
  updateComment,
  deleteComment,
} from '../../../storage/presentations/comments.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import {
  getGuestFromRequest,
  withPresentationReadAuth,
} from '../../../utils/route-middleware.js';
import { notifyMentionsAdded } from '../../../services/comment-notifications.js';
import {
  createComment,
  MAX_COMMENT_LENGTH,
  broadcastCommentCounts,
} from '../../../services/comments.js';
import { ForbiddenError } from '../../../utils/errors.js';
import { getString } from '../../../utils/request-validators.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';

/**
 * Whoever reached the deck — the account, or the share-link guest session the
 * read fell back to — may edit this comment when it is theirs (or they
 * moderate).
 */
function mayEditComment({ authedUser, guestInfo, comment }) {
  return guestInfo
    ? canGuestEditComment({ guest: guestInfo.guest, comment })
    : canEditComment({ user: authedUser, comment });
}

/** As {@link mayEditComment}, for deletion (the deck owner also moderates). */
function mayDeleteComment({ authedUser, guestInfo, pres, comment }) {
  return guestInfo
    ? canGuestDeleteComment({ guest: guestInfo.guest, comment })
    : canDeleteComment({ user: authedUser, pres, comment });
}

/**
 * Create a new comment.
 * POST /api/presentations/:id/comments
 * Body: { body, slideId?, parentId?, positionX?, positionY? }
 *
 * The flow is `services/comments.js`; this adapter parses the body and names
 * who is asking. This contract is the one that can carry two credentials at
 * once — a signed-in session and a share-link guest session — and its rule is
 * that the account comments when it may, otherwise the guest session on this
 * deck does. The service decides "may"; a refusal of the account falls back to
 * the guest, never the other way round.
 */
export async function handlePresentationCommentsCreate(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const input = {
    presentationId: id,
    body: body.body,
    slideId: body.slideId || null,
    parentId: body.parentId || null,
    positionX: body.positionX,
    positionY: body.positionY,
  };

  let created;
  try {
    created = await createComment(storageScope, { actor: authedUser }, input);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
    const guestInfo = await getGuestFromRequest(req);
    if (!guestInfo) throw err;
    created = await createComment(storageScope, guestInfo, input);
  }

  serveJson(res, 201, { ok: true, comment: created.comment });
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
  commentId,
) {
  if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);

  const { pres, guestInfo } = await withPresentationReadAuth({
    storageScope,
    req,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  if (!mayEditComment({ authedUser, guestInfo, pres, comment })) {
    return forbidden(res);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if (!getString(body, 'body').trim()) {
    return badRequest(res, 'Comment body is required');
  }

  // Validate comment body length
  if (body.body.length > MAX_COMMENT_LENGTH) {
    return badRequest(
      res,
      `Comment must be ${MAX_COMMENT_LENGTH} characters or less`,
    );
  }

  const result = await updateComment(storageScope, commentId, {
    body: body.body,
  });

  if (!result.ok) {
    return storageError(res, result);
  }

  // A mention added by the edit notifies like a fresh mention (diffed
  // against the pre-edit list, so re-saving never re-notifies).
  fireAndForget(
    (async () => {
      const parentComment = result.comment?.parentId
        ? await getComment(storageScope, result.comment.parentId)
        : null;
      await notifyMentionsAdded(repoRoot, {
        presentation: pres,
        comment: result.comment,
        previousMentions: comment.mentions,
        parentComment,
        // A guest editing their own comment: the notification actor is them.
        // A comment names its author and carries no address (D22), so the
        // address comes from the row, server-side.
        actor: authedUser || {
          email: await getCommentAuthorEmail(storageScope, comment.id),
          name: comment.author?.displayName || '',
        },
        scope: storageScope,
      });
    })(),
    'mention-on-edit notification fan-out',
  );

  // Broadcast to all connected clients (non-blocking)
  broadcastToPresentation(id, CommentEventTypes.UPDATED, {
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
  commentId,
) {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  const { pres, guestInfo } = await withPresentationReadAuth({
    storageScope,
    req,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  if (!mayDeleteComment({ authedUser, guestInfo, pres, comment })) {
    return forbidden(res);
  }

  const result = await deleteComment(storageScope, commentId);
  if (!result.ok) {
    return storageError(res, result);
  }

  // Broadcast to all connected clients (non-blocking)
  broadcastToPresentation(id, CommentEventTypes.DELETED, {
    commentId,
    slideId: comment.slideId,
  });
  fireAndForget(
    broadcastCommentCounts(id, storageScope),
    'broadcast comment counts',
  );

  serveJson(res, 200, result);
  return true;
}
