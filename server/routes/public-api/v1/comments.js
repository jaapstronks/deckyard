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
import {
  listComments,
  getComment,
  resolveComment,
  reopenComment,
  dismissComment,
} from '../../../storage/presentations/comments.js';
import { canResolveComment } from '../../../utils/presentation-authz/index.js';
import {
  enrichCommentsWithSlideContext,
  slideContextFor,
} from '../../../services/comment-slide-context.js';
import {
  recordCommentResolved,
  recordCommentReopened,
} from '../../../services/activity-events.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import {
  createComment,
  broadcastCommentCounts,
} from '../../../services/comments.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  getPresentationWithAccess,
  readApiV1Body,
  apiSuccess,
  apiCreated,
  apiError,
} from './middleware.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';

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
 * The public shape of one comment: **ids only**, like every other v1 payload.
 *
 * The app API names a comment's author with `{ id, displayName }` (D22); v1
 * publishes the id alone — `authorId` beside `ownerId` and `createdById` — and
 * leaves a machine consumer to resolve names itself. It used to hand out
 * `authorEmail`/`authorName` to any key with `comments:read`.
 *
 * @param {Object} comment - A storage comment
 * @param {Object} pres - The deck it belongs to
 * @returns {Object}
 */
function sanitizeComment(comment, pres) {
  const { author, authorGuestId, isAi, ...rest } = comment;
  return {
    ...rest,
    authorId: author?.id || null,
    // A share-link guest has no `users.id`; their comments are attributed to
    // the guest identity the deck owner invited.
    authorGuestId: authorGuestId || null,
    isAi: !!isAi,
    resolvedById: comment.resolvedBy?.id || null,
    resolvedBy: undefined,
    editUrl: commentEditUrl(pres.id, comment.slideId),
  };
}

/**
 * Add slide context + editUrl to a list of comments (and replies).
 */
function decorateComments(comments, pres) {
  return enrichCommentsWithSlideContext(comments, pres).map((c) => ({
    ...sanitizeComment(c, pres),
    replies: (c.replies || []).map((r) => ({
      ...sanitizeComment(r, pres),
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

  if (!requirePermission(ctx, 'comments:read')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId);
  if (!ok) return true;

  const status = url.searchParams.get('status') || 'all';
  if (!['open', 'resolved', 'dismissed', 'all'].includes(status)) {
    await apiError(
      ctx,
      400,
      'Invalid status filter (open|resolved|dismissed|all)',
    );
    return true;
  }

  const sinceResult = parseSinceParam(url);
  if (!sinceResult.ok) {
    await apiError(
      ctx,
      400,
      'Invalid since parameter (use an ISO 8601 date/datetime)',
    );
    return true;
  }

  const comments = await listComments(ctx.storageScope, presentationId, {
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
 * Body: { body, slideId?, parentId? }. Author = the API key owner. The flow —
 * comment right, validation, snapshot, notifications — is
 * `services/comments.js`; a refusal is thrown and `withV1ErrorHandler`
 * renders it.
 */
async function handleCreateComment(ctx, presentationId) {
  const { req, authedUser } = ctx;

  if (!requirePermission(ctx, 'comments:write')) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, req);
  if (!bodyOk) return true;

  const { comment, presentation } = await createComment(
    ctx.storageScope,
    { actor: authedUser },
    {
      presentationId,
      body: body?.body,
      slideId: body?.slideId || null,
      parentId: body?.parentId || null,
    },
  );

  await apiCreated(ctx, {
    ok: true,
    comment: {
      ...sanitizeComment(comment, presentation),
      slide: slideContextFor(presentation, comment.slideId),
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
  const { req, apiKey, authedUser } = ctx;

  if (!requirePermission(ctx, 'comments:write')) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, req);
  if (!bodyOk) return true;

  const status = body?.status;
  if (!['resolved', 'open', 'dismissed'].includes(status)) {
    await apiError(ctx, 400, 'Invalid status (resolved|open|dismissed)');
    return true;
  }

  const sctx = ctx.storageScope;
  const comment = await getComment(sctx, commentId);
  if (!comment) {
    await apiError(ctx, 404, 'Comment not found');
    return true;
  }

  const { ok, pres } = await getPresentationWithAccess(
    ctx,
    comment.presentationId,
  );
  if (!ok) return true;

  // Same rule as the app: only the presentation owner/creator moderates. The
  // context's authed user carries the API-key owner's resolved `users.id`, so
  // this decides on the stable key like every other ownership check.
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    await apiError(
      ctx,
      403,
      'Only the presentation owner can change comment status',
    );
    return true;
  }

  let result;
  if (status === 'resolved') {
    result = await resolveComment(sctx, commentId, {
      email: apiKey.ownerEmail,
    });
  } else if (status === 'dismissed') {
    result = await dismissComment(sctx, commentId, {
      email: apiKey.ownerEmail,
    });
  } else {
    result = await reopenComment(sctx, commentId);
  }

  if (!result.ok) {
    await apiError(ctx, 409, `Could not change status: ${result.reason}`);
    return true;
  }

  const actor = { email: apiKey.ownerEmail };
  if (status === 'resolved') {
    fireAndForget(
      recordCommentResolved({
        comment: result.comment,
        presentation: pres,
        actor,
        scope: sctx,
      }),
      'record comment-resolved activity',
    );
    broadcastToPresentation(pres.id, CommentEventTypes.RESOLVED, {
      comment: result.comment,
    });
  } else if (status === 'open') {
    fireAndForget(
      recordCommentReopened({
        comment: result.comment,
        presentation: pres,
        actor,
        scope: sctx,
      }),
      'record comment-reopened activity',
    );
    broadcastToPresentation(pres.id, CommentEventTypes.REOPENED, {
      comment: result.comment,
    });
  } else {
    broadcastToPresentation(pres.id, CommentEventTypes.RESOLVED, {
      comment: result.comment,
    });
  }
  fireAndForget(
    broadcastCommentCounts(pres.id, sctx),
    'broadcast comment counts',
  );

  await apiSuccess(ctx, {
    ok: true,
    comment: {
      ...sanitizeComment(result.comment, pres),
      slide: slideContextFor(pres, result.comment.slideId),
    },
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/** Comment routes; a known path with another method answers 405. */
export const ROUTES = [
  {
    method: 'GET',
    id: 'listComments',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/comments$/,
    captures: ['uuid'],
    handler: handleListComments,
  },
  {
    method: 'POST',
    id: 'createComment',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/comments$/,
    captures: ['uuid'],
    handler: handleCreateComment,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/comments$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET', 'POST']),
  },
  {
    method: 'POST',
    id: 'setCommentStatus',
    pattern: /^\/api\/v1\/comments\/([^/]+)\/status$/,
    captures: ['uuid'],
    handler: handleCommentStatus,
  },
  {
    pattern: /^\/api\/v1\/comments\/([^/]+)\/status$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['POST']),
  },
];

/**
 * Main handler for public API v1 comment routes.
 */
export const handleComments = withV1ErrorHandler(
  'public-api-v1:comments',
  (ctx) => dispatchV1Routes(ROUTES, ctx),
);
