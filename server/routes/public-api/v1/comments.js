/**
 * Public API v1 - Comments on presentations.
 *
 * Lets agents/scripts with an API key read reviewer feedback and respond to
 * it: list comments (with slide context + create-time snapshot), create
 * comments/replies as the key owner, and resolve/reopen/dismiss.
 *
 * Scopes: `comments:read` for GET, `comments:write` for mutations.
 * Requires the DB storage backend (file mode has no comment store).
 */

import { getAppBaseUrl } from '../../../config/utils.js';
import { methodNotAllowed } from '../../../utils/http.js';
import {
  listComments,
  getComment,
  createComment,
  resolveComment,
  reopenComment,
  dismissComment,
} from '../../../storage/presentation-comments.js';
import {
  canActorCommentOnPresentation,
  canResolveComment,
} from '../../../utils/presentation-authz.js';
import {
  buildSlideSnapshot,
  enrichCommentsWithSlideContext,
  slideContextFor,
} from '../../../services/comment-slide-context.js';
import {
  recordCommentCreated,
  recordCommentResolved,
  recordCommentReopened,
} from '../../../services/activity-events.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { notifyCommentCreated } from '../../../services/comment-notifications.js';
import { broadcastCommentCounts, MAX_COMMENT_LENGTH } from '../../api/presentations/comments-shared.js';
import {
  requireScope,
  getPresentationWithAccess,
  parseJsonBody,
  apiSuccess,
  apiCreated,
  apiError,
} from './middleware.js';

/**
 * Storage context for the acting API key (same shape MCP tools use).
 */
function storageCtx(ctx) {
  return {
    actorEmail: ctx.apiKey?.ownerEmail,
    organizationId: ctx.apiKey?.organizationId,
  };
}

/**
 * Editor deep link for a comment: /app/:id, anchored to the commented
 * slide via ?slideId= (the editor and viewer both honor it).
 */
function commentEditUrl(presentationId, slideId) {
  const base = getAppBaseUrl();
  if (!base) return null;
  const anchor = slideId ? `?slideId=${encodeURIComponent(slideId)}` : '';
  return `${base}/app/${presentationId}${anchor}`;
}

/**
 * Add slide context + editUrl to a list of comments (and replies).
 */
function decorateComments(comments, pres) {
  return enrichCommentsWithSlideContext(comments, pres).map((c) => ({
    ...c,
    editUrl: commentEditUrl(pres.id, c.slideId),
    replies: (c.replies || []).map((r) => ({
      ...r,
      editUrl: commentEditUrl(pres.id, r.slideId || c.slideId),
    })),
  }));
}

/**
 * Parse and validate an optional `since` query param (ISO date/datetime).
 * Returns { ok, since } where since is a normalized ISO string or null.
 */
function parseSinceParam(url) {
  const raw = url.searchParams.get('since');
  if (!raw) return { ok: true, since: null };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false };
  }
  return { ok: true, since: parsed.toISOString() };
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/presentations/:id/comments - List comments.
 * Query: status (open|resolved|dismissed|all), slideId, since (ISO date).
 */
async function handleListComments(ctx, presentationId) {
  const { url } = ctx;

  if (!requireScope(ctx, 'comments:read')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId);
  if (!ok) return true;

  const status = url.searchParams.get('status') || 'all';
  if (!['open', 'resolved', 'dismissed', 'all'].includes(status)) {
    await apiError(ctx, 400, 'Invalid status filter (open|resolved|dismissed|all)');
    return true;
  }

  const sinceResult = parseSinceParam(url);
  if (!sinceResult.ok) {
    await apiError(ctx, 400, 'Invalid since parameter (use an ISO 8601 date/datetime)');
    return true;
  }

  const comments = await listComments(presentationId, storageCtx(ctx), {
    status: status === 'all' ? undefined : status,
    slideId: url.searchParams.get('slideId') || undefined,
    since: sinceResult.since || undefined,
  });

  await apiSuccess(ctx, {
    presentationId,
    presentationTitle: pres.title || 'Untitled',
    comments: decorateComments(comments, pres),
    total: comments.length,
    since: sinceResult.since,
  });
  return true;
}

/**
 * POST /api/v1/presentations/:id/comments - Create a comment or reply.
 * Body: { body, slideId?, parentId? }. Author = the API key owner.
 */
async function handleCreateComment(ctx, presentationId) {
  const { repoRoot, req, apiKey } = ctx;

  if (!requireScope(ctx, 'comments:write')) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, req);
  if (!bodyOk) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId);
  if (!ok) return true;

  // Commenting needs comment permission (owner/creator, workspace user, or
  // collaborator with comment rights or higher) — not full write access.
  if (!(await canActorCommentOnPresentation(pres, apiKey.ownerEmail))) {
    await apiError(ctx, 403, 'API key owner may not comment on this presentation');
    return true;
  }

  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) {
    await apiError(ctx, 400, 'Comment body is required');
    return true;
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    await apiError(ctx, 400, `Comment must be ${MAX_COMMENT_LENGTH} characters or less`);
    return true;
  }

  const slideId = body?.slideId || null;
  let slideSnapshot = null;
  if (slideId) {
    const slide = (pres.slides || []).find((s) => s?.id === slideId);
    if (!slide) {
      await apiError(ctx, 400, 'slideId does not exist in this presentation');
      return true;
    }
    slideSnapshot = buildSlideSnapshot(slide);
  }

  const sctx = storageCtx(ctx);

  // For replies: fetch the parent (notification recipient + 404 mapping).
  let parentComment = null;
  if (body?.parentId) {
    parentComment = await getComment(body.parentId, sctx);
    if (!parentComment || parentComment.presentationId !== presentationId) {
      await apiError(ctx, 404, 'Parent comment not found on this presentation');
      return true;
    }
  }

  const result = await createComment(presentationId, {
    email: apiKey.ownerEmail,
    body: text,
    slideId,
    parentId: body?.parentId || null,
    slideSnapshot,
  }, sctx);

  if (!result.ok) {
    await apiError(ctx, result.reason === 'unavailable' ? 503 : 400, `Could not create comment: ${result.reason}`);
    return true;
  }

  const actor = { email: apiKey.ownerEmail };

  // Same side effects as the internal route: notify, record, broadcast.
  void notifyCommentCreated(repoRoot, req, {
    presentation: pres,
    comment: result.comment,
    parentComment,
    actor,
    ctx: sctx,
  });
  void recordCommentCreated({
    comment: result.comment,
    presentation: pres,
    actor,
    ctx: sctx,
  });
  void broadcastToPresentation(presentationId, CommentEventTypes.CREATED, {
    comment: result.comment,
  });
  void broadcastCommentCounts(presentationId, sctx);

  await apiCreated(ctx, {
    ok: true,
    comment: {
      ...result.comment,
      slide: slideContextFor(pres, result.comment.slideId),
      editUrl: commentEditUrl(presentationId, result.comment.slideId),
    },
  });
  return true;
}

/**
 * POST /api/v1/comments/:commentId/status - Change a comment's status.
 * Body: { status: 'resolved' | 'open' | 'dismissed' }.
 * Allowed transitions follow the app: open→resolved, open→dismissed,
 * resolved→open. Only the presentation owner/creator may change status.
 */
async function handleCommentStatus(ctx, commentId) {
  const { repoRoot, req, apiKey } = ctx;

  if (!requireScope(ctx, 'comments:write')) return true;

  const { ok: bodyOk, body } = await parseJsonBody(ctx, req);
  if (!bodyOk) return true;

  const status = body?.status;
  if (!['resolved', 'open', 'dismissed'].includes(status)) {
    await apiError(ctx, 400, 'Invalid status (resolved|open|dismissed)');
    return true;
  }

  const sctx = storageCtx(ctx);
  const comment = await getComment(commentId, sctx);
  if (!comment) {
    await apiError(ctx, 404, 'Comment not found');
    return true;
  }

  const { ok, pres } = await getPresentationWithAccess(ctx, comment.presentationId);
  if (!ok) return true;

  // Same rule as the app: only the presentation owner/creator moderates.
  if (!canResolveComment({ user: { email: apiKey.ownerEmail }, pres, comment })) {
    await apiError(ctx, 403, 'Only the presentation owner can change comment status');
    return true;
  }

  let result;
  if (status === 'resolved') {
    result = await resolveComment(commentId, { email: apiKey.ownerEmail }, sctx);
  } else if (status === 'dismissed') {
    result = await dismissComment(commentId, { email: apiKey.ownerEmail }, sctx);
  } else {
    result = await reopenComment(commentId, sctx);
  }

  if (!result.ok) {
    await apiError(ctx, 409, `Could not change status: ${result.reason}`);
    return true;
  }

  const actor = { email: apiKey.ownerEmail };
  if (status === 'resolved') {
    void recordCommentResolved({ comment: result.comment, presentation: pres, actor, ctx: sctx });
    void broadcastToPresentation(pres.id, CommentEventTypes.RESOLVED, { comment: result.comment });
  } else if (status === 'open') {
    void recordCommentReopened({ comment: result.comment, presentation: pres, actor, ctx: sctx });
    void broadcastToPresentation(pres.id, CommentEventTypes.REOPENED, { comment: result.comment });
  } else {
    void broadcastToPresentation(pres.id, CommentEventTypes.RESOLVED, { comment: result.comment });
  }
  void broadcastCommentCounts(pres.id, sctx);

  await apiSuccess(ctx, {
    ok: true,
    comment: {
      ...result.comment,
      slide: slideContextFor(pres, result.comment.slideId),
      editUrl: commentEditUrl(pres.id, result.comment.slideId),
    },
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Main handler for public API v1 comment routes.
 */
export async function handleComments(ctx) {
  const { req, res, url } = ctx;

  // GET/POST /api/v1/presentations/:id/comments
  const collectionMatch = url.pathname.match(
    /^\/api\/v1\/presentations\/([^/]+)\/comments$/
  );
  if (collectionMatch) {
    if (req.method === 'GET') return handleListComments(ctx, collectionMatch[1]);
    if (req.method === 'POST') return handleCreateComment(ctx, collectionMatch[1]);
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  // POST /api/v1/comments/:commentId/status
  const statusMatch = url.pathname.match(/^\/api\/v1\/comments\/([^/]+)\/status$/);
  if (statusMatch) {
    if (req.method === 'POST') return handleCommentStatus(ctx, statusMatch[1]);
    return methodNotAllowed(res, ['POST']);
  }

  return false;
}
