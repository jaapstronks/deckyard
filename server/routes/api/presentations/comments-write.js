/**
 * Write route handlers for presentation comments.
 * Includes create, update, and delete operations.
 *
 * These are the signed-in account's routes, behind the login gate, and they
 * name the account and only the account. A share-link guest creates, edits
 * and deletes their own comments through their own routes under the share
 * token (`routes/api/share-links/guest-comments.js`): one path per kind of
 * commenter (D228). The flows themselves are `services/comments.js`.
 */

import {
  methodNotAllowed,
  requireJsonBody,
  serveJson,
} from '../../../utils/http.js';
import {
  createComment,
  commentInputFromBody,
  editComment,
  removeComment,
} from '../../../services/comments.js';

/**
 * Create a new comment.
 * POST /api/presentations/:id/comments
 * Body: { body, slideId?, parentId?, positionX?, positionY? }
 */
export async function handlePresentationCommentsCreate(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const created = await createComment(
    storageScope,
    { actor: authedUser },
    commentInputFromBody(id, parsed.body),
  );

  serveJson(res, 201, { ok: true, comment: created.comment });
  return true;
}

/**
 * Update a comment's body: its author, or an organization admin.
 * PUT /api/presentations/:id/comments/:commentId
 * Body: { body }
 */
export async function handlePresentationCommentUpdate(
  { storageScope, req, res, authedUser } = {},
  id,
  commentId,
) {
  if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const result = await editComment(
    storageScope,
    { actor: authedUser },
    { presentationId: id, commentId, body: parsed.body?.body },
  );

  serveJson(res, 200, result);
  return true;
}

/**
 * Delete a comment: its author, an organization admin, or the deck's owner or
 * creator.
 * DELETE /api/presentations/:id/comments/:commentId
 */
export async function handlePresentationCommentDelete(
  { storageScope, req, res, authedUser } = {},
  id,
  commentId,
) {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  const result = await removeComment(
    storageScope,
    { actor: authedUser },
    { presentationId: id, commentId },
  );

  serveJson(res, 200, result);
  return true;
}
