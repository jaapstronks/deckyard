/**
 * Presentation comments storage for collaborative annotations.
 * Allows workspace members to leave feedback on slides without editing.
 */

import { getOrgId } from '../utils/context.js';
import { norm, normalizeEmail, nowIso } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import { listPresentations } from './presentations.js';
import { listPresentationsSharedWithUser } from './collaborators.js';

// ============================================================
// COMMENTS CRUD
// ============================================================

/**
 * List comments for a presentation.
 * Can filter by slideId or status.
 */
export async function listComments(presentationId, ctx, opts = {}) {
  const pid = norm(presentationId);
  if (!pid) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    let query = db
      .selectFrom('presentation_comments')
      .selectAll()
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId);

    // Filter by slide
    if (opts?.slideId) {
      query = query.where('slide_id', '=', opts.slideId);
    }

    // Filter by status
    if (opts?.status === 'open') {
      query = query.where('status', '=', 'open');
    } else if (opts?.status === 'resolved') {
      query = query.where('status', '=', 'resolved');
    } else if (opts?.status === 'dismissed') {
      query = query.where('status', '=', 'dismissed');
    }

    // Filter by comment type (human vs ai-suggestion)
    if (opts?.commentType === 'human') {
      query = query.where('comment_type', '=', 'human');
    } else if (opts?.commentType === 'ai-suggestion') {
      query = query.where('comment_type', '=', 'ai-suggestion');
    }

    // Filter by suggestion category
    if (opts?.suggestionCategory) {
      query = query.where('suggestion_category', '=', opts.suggestionCategory);
    }

    // Only get top-level comments (not replies) for main list
    if (!opts?.includeReplies) {
      query = query.where('parent_id', 'is', null);
    }

    const rows = await query.orderBy('created_at', 'desc').execute();

    const comments = rows.map(rowToComment);

    // If we're getting top-level comments, also fetch their replies
    if (!opts?.includeReplies && comments.length > 0) {
      const commentIds = comments.map((c) => c.id);
      const repliesQuery = db
        .selectFrom('presentation_comments')
        .selectAll()
        .where('presentation_id', '=', pid)
        .where('organization_id', '=', orgId)
        .where('parent_id', 'in', commentIds)
        .orderBy('created_at', 'asc');

      const replyRows = await repliesQuery.execute();
      const repliesByParent = new Map();

      for (const row of replyRows) {
        const parentId = row.parent_id;
        if (!repliesByParent.has(parentId)) {
          repliesByParent.set(parentId, []);
        }
        repliesByParent.get(parentId).push(rowToComment(row));
      }

      for (const comment of comments) {
        comment.replies = repliesByParent.get(comment.id) || [];
      }
    }

    return comments;
  });
}

/**
 * Resolve the presentations the acting user may see, as `{ id, title }` refs.
 * Owned decks come from `listPresentations` (filtered by `ownerEmail`); shared
 * decks from `listPresentationsSharedWithUser` (DB-only, `[]` in file mode).
 * Built once so callers avoid per-comment N+1 title lookups.
 *
 * @param {string} repoRoot
 * @param {Object} ctx - Storage context; `ctx.actorEmail`/`ctx.ownerEmail` is
 *   the acting user, `ctx.organizationId` scopes shared lookups.
 * @param {'owned'|'shared'|'all'} [scope='all']
 * @returns {Promise<Array<{ id: string, title: string }>>}
 */
export async function listAccessiblePresentationRefs(repoRoot, ctx, scope = 'all') {
  const owner = normalizeEmail(ctx?.actorEmail || ctx?.ownerEmail);
  if (!owner) return [];

  const wantOwned = scope === 'owned' || scope === 'all';
  const wantShared = scope === 'shared' || scope === 'all';

  const titleById = new Map();

  if (wantOwned) {
    const all = await listPresentations(repoRoot);
    for (const p of all) {
      if (normalizeEmail(p.ownerEmail) === owner) {
        titleById.set(p.id, p.title || 'Untitled');
      }
    }
  }

  if (wantShared) {
    const shared = await listPresentationsSharedWithUser(owner, ctx);
    for (const p of shared) {
      if (!titleById.has(p.id)) titleById.set(p.id, p.title || 'Untitled');
    }
  }

  return [...titleById.entries()].map(([id, title]) => ({ id, title }));
}

/**
 * List the most recent top-level comments across every presentation the acting
 * user can see (owned and/or shared), newest first. Powers cross-deck review
 * queries ("latest comments on my decks", optionally by one reviewer) that the
 * per-deck listComments() can't answer.
 *
 * File mode has no comment store, so this resolves to an empty result there.
 *
 * @param {string} repoRoot
 * @param {Object} ctx - Storage context (acting user + org, as above).
 * @param {Object} [opts]
 * @param {'owned'|'shared'|'all'} [opts.scope='all'] - Which decks to include.
 * @param {string|null} [opts.authorEmail=null] - Filter to one comment author.
 * @param {'open'|'resolved'|'dismissed'|'all'} [opts.status='all']
 * @param {number} [opts.limit=50] - Max comments (clamped to 1..200).
 * @returns {Promise<{ comments: Array, total: number }>} Comments enriched with
 *   `presentationTitle`; `total` is the number returned.
 */
export async function listRecentCommentsForOwner(repoRoot, ctx, opts = {}) {
  const scope = ['owned', 'shared', 'all'].includes(opts?.scope) ? opts.scope : 'all';
  const authorEmail = opts?.authorEmail ? normalizeEmail(opts.authorEmail) : null;
  const status = ['open', 'resolved', 'dismissed', 'all'].includes(opts?.status)
    ? opts.status
    : 'all';
  const limit = Math.max(1, Math.min(200, Number(opts?.limit) || 50));

  const refs = await listAccessiblePresentationRefs(repoRoot, ctx, scope);
  if (refs.length === 0) return { comments: [], total: 0 };

  const titleById = new Map(refs.map((r) => [r.id, r.title]));
  const ids = refs.map((r) => r.id);

  return withDbGuard({ comments: [], total: 0 }, async (db) => {
    const orgId = getOrgId(ctx);

    let query = db
      .selectFrom('presentation_comments')
      .selectAll()
      .where('presentation_id', 'in', ids)
      .where('organization_id', '=', orgId)
      .where('parent_id', 'is', null); // top-level comments only

    if (authorEmail) query = query.where('author_email', '=', authorEmail);
    if (status !== 'all') query = query.where('status', '=', status);

    const rows = await query.orderBy('created_at', 'desc').limit(limit).execute();

    const comments = rows.map((row) => {
      const comment = rowToComment(row);
      comment.presentationTitle = titleById.get(comment.presentationId) || null;
      return comment;
    });

    return { comments, total: comments.length };
  });
}

/**
 * Get a single comment by ID.
 */
export async function getComment(commentId, ctx) {
  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('presentation_comments')
      .selectAll()
      .where('id', '=', commentId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!row) return null;

    const comment = rowToComment(row);

    // Fetch replies if this is a top-level comment
    if (!row.parent_id) {
      const replyRows = await db
        .selectFrom('presentation_comments')
        .selectAll()
        .where('parent_id', '=', commentId)
        .where('organization_id', '=', orgId)
        .orderBy('created_at', 'asc')
        .execute();

      comment.replies = replyRows.map(rowToComment);
    }

    return comment;
  });
}

/**
 * Create a new comment or reply.
 */
export async function createComment(presentationId, data, ctx) {
  const pid = norm(presentationId);
  const authorEmail = norm(data?.email || ctx?.actorEmail).toLowerCase();
  const authorName = norm(data?.name) || authorEmail;
  const body = norm(data?.body);

  if (!pid || !authorEmail || !body) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    // If this is a reply, validate parent exists
    const parentId = data?.parentId || null;
    if (parentId) {
      const parent = await db
        .selectFrom('presentation_comments')
        .select('id')
        .where('id', '=', parentId)
        .where('presentation_id', '=', pid)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!parent) {
        return { ok: false, reason: 'parent_not_found' };
      }
    }

    // Position values (percentage 0-100, null if not positioned)
    const positionX = typeof data?.positionX === 'number' ? data.positionX : null;
    const positionY = typeof data?.positionY === 'number' ? data.positionY : null;

    // AI suggestion fields
    const commentType = data?.commentType || 'human';
    const suggestionCategory = data?.suggestionCategory || null;
    const proposedSlide = data?.proposedSlide || null;

    const row = await db
      .insertInto('presentation_comments')
      .values({
        presentation_id: pid,
        organization_id: orgId,
        slide_id: data?.slideId || null,
        parent_id: parentId,
        author_email: authorEmail,
        author_name: authorName,
        body: body,
        status: 'open',
        position_x: positionX,
        position_y: positionY,
        comment_type: commentType,
        suggestion_category: suggestionCategory,
        proposed_slide: proposedSlide ? JSON.stringify(proposedSlide) : null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      comment: rowToComment(row),
    };
  });
}

/**
 * Update a comment's body.
 * Only the author can update.
 */
export async function updateComment(commentId, data, ctx) {
  const body = norm(data?.body);
  if (!body) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    const row = await db
      .updateTable('presentation_comments')
      .set({
        body: body,
        updated_at: now,
      })
      .where('id', '=', commentId)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      comment: rowToComment(row),
    };
  });
}

/**
 * Resolve a comment (mark as resolved).
 * Only presentation owner/admin can resolve.
 */
export async function resolveComment(commentId, { email } = {}, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();
    const resolverEmail = norm(email).toLowerCase();

    const row = await db
      .updateTable('presentation_comments')
      .set({
        status: 'resolved',
        resolved_by: resolverEmail,
        resolved_at: now,
        updated_at: now,
      })
      .where('id', '=', commentId)
      .where('organization_id', '=', orgId)
      .where('status', '=', 'open')
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found_or_already_resolved' };
    }

    return {
      ok: true,
      comment: rowToComment(row),
    };
  });
}

/**
 * Reopen a resolved comment.
 */
export async function reopenComment(commentId, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    const row = await db
      .updateTable('presentation_comments')
      .set({
        status: 'open',
        resolved_by: null,
        resolved_at: null,
        updated_at: now,
      })
      .where('id', '=', commentId)
      .where('organization_id', '=', orgId)
      .where('status', '=', 'resolved')
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found_or_not_resolved' };
    }

    return {
      ok: true,
      comment: rowToComment(row),
    };
  });
}

/**
 * Dismiss an AI suggestion (different from resolve).
 * Sets status to 'dismissed' for AI suggestions.
 */
export async function dismissComment(commentId, { email } = {}, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();
    const dismisserEmail = norm(email).toLowerCase();

    const row = await db
      .updateTable('presentation_comments')
      .set({
        status: 'dismissed',
        resolved_by: dismisserEmail,
        resolved_at: now,
        updated_at: now,
      })
      .where('id', '=', commentId)
      .where('organization_id', '=', orgId)
      .where('status', '=', 'open')
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found_or_already_handled' };
    }

    return {
      ok: true,
      comment: rowToComment(row),
    };
  });
}

/**
 * Delete a comment.
 * Cascades to replies via FK constraint.
 */
export async function deleteComment(commentId, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('presentation_comments')
      .where('id', '=', commentId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return {
      ok: true,
      deleted: result.numDeletedRows > 0,
    };
  });
}

/**
 * Get count of open comments for a presentation.
 * Useful for badge display.
 */
export async function getOpenCommentCount(presentationId, ctx) {
  const pid = norm(presentationId);
  if (!pid) return 0;

  return withDbGuard(0, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .selectFrom('presentation_comments')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('status', '=', 'open')
      .where('parent_id', 'is', null) // Only count top-level comments
      .executeTakeFirst();

    return Number(result?.count) || 0;
  });
}

/**
 * Get comment counts per slide for a presentation.
 * Useful for showing indicators on slide previews.
 */
export async function getCommentCountsBySlide(presentationId, ctx) {
  const pid = norm(presentationId);
  if (!pid) return {};

  return withDbGuard({}, async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('presentation_comments')
      .select(['slide_id', (eb) => eb.fn.count('id').as('count')])
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('slide_id', 'is not', null)
      .where('status', '=', 'open')
      .where('parent_id', 'is', null) // Only count top-level comments
      .groupBy('slide_id')
      .execute();

    const counts = {};
    for (const row of rows) {
      if (row.slide_id) {
        counts[row.slide_id] = Number(row.count) || 0;
      }
    }

    return counts;
  });
}

// ============================================================
// HELPERS
// ============================================================

function rowToComment(row) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    slideId: row.slide_id,
    parentId: row.parent_id,
    authorEmail: row.author_email,
    authorName: row.author_name,
    body: row.body,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    positionX: row.position_x ?? null,
    positionY: row.position_y ?? null,
    commentType: row.comment_type ?? 'human',
    suggestionCategory: row.suggestion_category ?? null,
    proposedSlide: row.proposed_slide ?? null,
    replies: [], // Populated separately
  };
}