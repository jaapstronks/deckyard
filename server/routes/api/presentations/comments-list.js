/**
 * Read-only route handlers for presentation comments.
 * Includes list, get single, counts, and SSE events.
 */

import { methodNotAllowed, serveJson, notFound } from '../../../utils/http.js';
import {
  listComments,
  getComment,
  getOpenCommentCount,
  getCommentCountsBySlide,
} from '../../../storage/presentations/comments.js';
import {
  addClient,
  removeClient,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { withPresentationReadAuth } from '../../../utils/route-middleware.js';
import { openSseStream, sseWrite } from '../../../utils/sse.js';

/**
 * List comments for a presentation.
 * GET /api/presentations/:id/comments
 * Query params: slideId, status (open|resolved|all)
 *
 * Supports both authenticated users and verified guests with share link access.
 */
export async function handlePresentationCommentsList(
  { storageScope, req, res, url, authedUser } = {},
  id,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { pres } = await withPresentationReadAuth({
    storageScope,
    req,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  const slideId = url.searchParams.get('slideId') || null;
  const status = url.searchParams.get('status') || 'all';
  const commentType = url.searchParams.get('commentType') || null;

  const comments = await listComments(storageScope, id, {
    slideId,
    status,
    commentType,
  });
  const openCount = await getOpenCommentCount(storageScope, id);

  // The AI-author address used to ship with the list so the client could
  // recognise legacy AI-suggestion comments (those that predate the
  // `commentType` field, and self-hosters with a custom aiAssistant.email) by
  // comparing it against each comment's author address. Both addresses are
  // gone from the payload (D22): the storage layer answers the same question
  // per comment with `isAi`.
  serveJson(res, 200, { ok: true, comments, openCount });
  return true;
}

/**
 * Get a single comment.
 * GET /api/presentations/:id/comments/:commentId
 *
 * Supports both authenticated users and verified guests with share link access.
 */
export async function handlePresentationCommentGet(
  { storageScope, req, res, authedUser } = {},
  id,
  commentId,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { pres } = await withPresentationReadAuth({
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

  serveJson(res, 200, { ok: true, comment });
  return true;
}

/**
 * Get comment counts per slide.
 * GET /api/presentations/:id/comments/counts
 *
 * Supports both authenticated users and verified guests with share link access.
 */
export async function handlePresentationCommentCounts(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { pres } = await withPresentationReadAuth({
    storageScope,
    req,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  const counts = await getCommentCountsBySlide(storageScope, id);
  const total = await getOpenCommentCount(storageScope, id);

  serveJson(res, 200, { ok: true, counts, total });
  return true;
}

/**
 * SSE endpoint for real-time comment updates.
 * GET /api/presentations/:id/comments/events
 *
 * Clients connect here to receive instant notifications when comments change.
 * Supports both authenticated users and verified guests with share link access.
 */
export async function handlePresentationCommentEvents(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { pres } = await withPresentationReadAuth({
    storageScope,
    req,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;

  // Send initial connection confirmation
  sseWrite(res, { event: 'connected', data: { presentationId: id } });

  // Register this client
  addClient(id, res);

  // Send current counts immediately so client has latest state
  try {
    const counts = await getCommentCountsBySlide(storageScope, id);
    const total = await getOpenCommentCount(storageScope, id);
    sseWrite(res, {
      event: CommentEventTypes.COUNTS_CHANGED,
      data: { counts, total },
    });
  } catch {
    // Ignore initial counts error
  }

  // Handle client disconnect
  req.on('close', () => {
    removeClient(id, res);
  });

  // Keep connection open - don't end the response
  return true;
}
