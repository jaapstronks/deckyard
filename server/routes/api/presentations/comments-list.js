/**
 * Read-only route handlers for presentation comments.
 * Includes list, get single, counts, and SSE events.
 */

import {
  methodNotAllowed,
  serveJson,
  notFound,
} from '../../../utils/http.js';
import {
  listComments,
  getComment,
  getOpenCommentCount,
  getCommentCountsBySlide,
} from '../../../storage/presentation-comments.js';
import {
  addClient,
  removeClient,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { withPresentationReadAuth } from '../../../utils/route-middleware.js';
import { getCtx } from './comments-shared.js';

/**
 * List comments for a presentation.
 * GET /api/presentations/:id/comments
 * Query params: slideId, status (open|resolved|all)
 *
 * Supports both authenticated users and verified guests with share link access.
 */
export async function handlePresentationCommentsList(
  { repoRoot, req, res, url, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { pres } = await withPresentationReadAuth({ repoRoot, req, id, authedUser, res });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const slideId = url.searchParams.get('slideId') || null;
  const status = url.searchParams.get('status') || 'all';
  const commentType = url.searchParams.get('commentType') || null;

  const comments = await listComments(id, ctx, { slideId, status, commentType });
  const openCount = await getOpenCommentCount(id, ctx);

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
  { repoRoot, req, res, authedUser } = {},
  id,
  commentId
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { pres } = await withPresentationReadAuth({ repoRoot, req, id, authedUser, res });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const comment = await getComment(commentId, ctx);

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
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { pres } = await withPresentationReadAuth({ repoRoot, req, id, authedUser, res });
  if (!pres) return true;

  const ctx = getCtx(authedUser);
  const counts = await getCommentCountsBySlide(id, ctx);
  const total = await getOpenCommentCount(id, ctx);

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
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { pres } = await withPresentationReadAuth({ repoRoot, req, id, authedUser, res });
  if (!pres) return true;

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ presentationId: id })}\n\n`);

  // Register this client
  addClient(id, res);

  // Send current counts immediately so client has latest state
  const ctx = getCtx(authedUser);
  try {
    const counts = await getCommentCountsBySlide(id, ctx);
    const total = await getOpenCommentCount(id, ctx);
    res.write(`event: ${CommentEventTypes.COUNTS_CHANGED}\ndata: ${JSON.stringify({ counts, total })}\n\n`);
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