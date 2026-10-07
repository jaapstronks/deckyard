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
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { listComments } from '../../../storage/presentations/comments.js';
import {
  enrichCommentsWithSlideContext,
  slideContextFor,
} from '../../../services/comment-slide-context.js';
import { createComment, setCommentStatus } from '../../../services/comments.js';
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
 * @param {Array} comments
 * @param {Object} pres
 * @param {Object} slideTypes - The org's merged registry
 */
function decorateComments(comments, pres, slideTypes) {
  return enrichCommentsWithSlideContext(comments, pres, { slideTypes }).map(
    (c) => ({
      ...sanitizeComment(c, pres),
      replies: (c.replies || []).map((r) => ({
        ...sanitizeComment(r, pres),
        editUrl: commentEditUrl(pres.id, r.slideId || c.slideId),
      })),
    }),
  );
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
    comments: decorateComments(
      comments,
      pres,
      await buildMergedSlideTypes(ctx.storageScope),
    ),
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
      slide: slideContextFor(presentation, comment.slideId, {
        slideTypes: await buildMergedSlideTypes(ctx.storageScope),
      }),
    },
  });
  return true;
}

/**
 * POST /api/v1/comments/:commentId/status - Change a comment's status.
 * Body: { status: 'resolved' | 'open' | 'dismissed' }. Who may moderate and
 * which transition is allowed is `setCommentStatus` (`services/comments.js`);
 * a refusal is thrown and `withV1ErrorHandler` renders it.
 */
async function handleCommentStatus(ctx, commentId) {
  const { req, authedUser } = ctx;

  if (!requirePermission(ctx, 'comments:write')) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, req);
  if (!bodyOk) return true;

  const { comment, presentation } = await setCommentStatus(
    ctx.storageScope,
    { actor: authedUser },
    { commentId, status: body?.status },
  );

  await apiSuccess(ctx, {
    ok: true,
    comment: {
      ...sanitizeComment(comment, presentation),
      slide: slideContextFor(presentation, comment.slideId, {
        slideTypes: await buildMergedSlideTypes(ctx.storageScope),
      }),
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
