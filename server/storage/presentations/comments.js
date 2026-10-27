/**
 * Presentation comments storage for collaborative annotations.
 * Allows organization members to leave feedback on slides without editing.
 */
import { withContentTransaction } from '../../db/client.js';
import { assertCurrentCustomFields } from '../content-write.js';

import { getOrgId } from '../../utils/context.js';
import { norm, nowIso } from '../../utils/normalize.js';
import { normalizeEmail } from '../../../shared/email.js';
import { parseMentions } from '../../../shared/comment-mentions.js';
import { toStorageContext } from '../scope.js';
import { withDbGuard } from '../../db/client.js';
import { resolveIdentityByEmail } from '../identity-resolver.js';
import { getAiIdentity } from '../settings.js';
import { isAiAuthorEmail } from '../../../shared/constants/ai.js';
import {
  NO_DISPLAY_NAMES,
  resolveDisplayNames,
  toDisplayIdentity,
  toStoredActorIdentity,
} from '../display-identity.js';
import { keysetPage, keysetRows } from '../keyset.js';
import { deckListedCondition } from './deck-list.js';

/**
 * What a batch of comment rows needs resolved before it can be mapped.
 *
 * @typedef {Object} CommentReadContext
 * @property {import('../display-identity.js').DisplayNameLookup} lookup
 * @property {(email: string|null|undefined) => boolean} isAi - Whether an
 *   address is the instance's AI assistant. A predicate rather than the
 *   address itself: the answer crosses the boundary, the address does not.
 */

/** The context for a mapper whose caller resolved nothing. */
const NO_COMMENT_CONTEXT = Object.freeze({
  lookup: NO_DISPLAY_NAMES,
  isAi: (email) => isAiAuthorEmail(email),
});

/**
 * Resolve the display names and the AI identity a batch of comment rows needs.
 *
 * Both halves are one round trip each and both are memoized (display names in
 * storage/display-identity.js, app settings in storage/settings.js), so calling
 * this per read is cheap and calling it once per batch is cheaper.
 *
 * @param {Array<Object>} rows - Raw `presentation_comments` rows.
 * @param {import('../scope.js').StorageScope|object} scope
 * @returns {Promise<CommentReadContext>}
 */
async function commentReadContext(rows, scope) {
  const [lookup, ai] = await Promise.all([
    resolveDisplayNames(
      scope,
      (rows || [])
        .filter(Boolean)
        .flatMap((row) => [
          { id: row.author_user_id, email: row.author_email },
          { email: row.resolved_by },
        ]),
    ),
    getAiIdentity(scope).catch(() => null),
  ]);
  return { lookup, isAi: (email) => isAiAuthorEmail(email, ai?.email) };
}

// ============================================================
// COMMENTS CRUD
// ============================================================

/**
 * The comments on one deck, newest first, as one keyset page or (without
 * `limit`) the whole list (B824, D358). The order is
 * `(created_at desc, id desc)`.
 *
 * A page counts threads: without `includeReplies` it holds top-level comments,
 * each with all its replies attached; with it, every comment is a row of its
 * own and the page counts those.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {Object} [opts] - Filters: `slideId`, `status`, `commentType`,
 *   `suggestionCategory`, `since` (ISO, inclusive), `includeReplies`.
 * @param {Object} [page]
 * @param {number} [page.limit] - Rows per page; the whole list when absent.
 * @param {{value: string, id: string}|null} [page.after] - Position of the
 *   last row seen.
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
export async function listComments(
  scope,
  presentationId,
  opts = {},
  { limit, after = null } = {},
) {
  toStorageContext(scope, 'listComments');
  const pid = norm(presentationId);
  if (!pid) return { items: [], next: null };

  return withDbGuard({ items: [], next: null }, async (db) => {
    const orgId = getOrgId(scope);

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

    // Only comments created at/after this ISO timestamp ("new since ...")
    if (opts?.since) {
      query = query.where('created_at', '>=', opts.since);
    }

    // Only get top-level comments (not replies) for main list
    if (!opts?.includeReplies) {
      query = query.where('parent_id', 'is', null);
    }

    let rows;
    let next = null;
    if (limit === undefined) {
      rows = await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
    } else {
      ({ rows, next } = keysetRows(
        await keysetPage(query, {
          column: 'created_at',
          after,
          limit,
        }).execute(),
        limit,
      ));
    }

    // Fetch the replies before mapping anything, so one name lookup covers the
    // whole page (threads and replies alike) instead of one per thread.
    const replyRows =
      !opts?.includeReplies && rows.length > 0
        ? await db
            .selectFrom('presentation_comments')
            .selectAll()
            .where('presentation_id', '=', pid)
            .where('organization_id', '=', orgId)
            .where(
              'parent_id',
              'in',
              rows.map((r) => r.id),
            )
            .orderBy('created_at', 'asc')
            .orderBy('id', 'asc')
            .execute()
        : [];

    const ctx = await commentReadContext([...rows, ...replyRows], scope);
    const comments = rows.map((row) => rowToComment(row, ctx));

    // If we're getting top-level comments, also attach their replies
    if (!opts?.includeReplies && comments.length > 0) {
      const repliesByParent = new Map();

      for (const row of replyRows) {
        const parentId = row.parent_id;
        if (!repliesByParent.has(parentId)) {
          repliesByParent.set(parentId, []);
        }
        repliesByParent.get(parentId).push(rowToComment(row, ctx));
      }

      for (const comment of comments) {
        comment.replies = repliesByParent.get(comment.id) || [];
      }

      // Per-user read-state on threads. Guests have no account, so requests
      // without an acting user get no annotation (and the panel no dots).
      await annotateThreadReadState(db, comments, scope);
    }

    return { items: comments, next };
  });
}

/**
 * Annotate top-level comments with `unreadForUser` + `lastActivityAt` for
 * the acting user. A thread is unread when someone ELSE'S activity (the
 * top-level comment or a reply) is newer than the user's `last_read_at`;
 * threads where the user wrote the latest foreign-free activity are never
 * unread, so your own fresh comment doesn't dot itself.
 */
async function annotateThreadReadState(db, threads, scope) {
  const userEmail = normalizeEmail(scope?.actorEmail);
  // Authorship is compared on the stable id (D22), so an actor without one
  // gets no annotation — the same answer guests already got.
  const userId = scope?.actorUserId || null;
  if (!userEmail || !userId || threads.length === 0) return;

  const rows = await db
    .selectFrom('comment_thread_reads')
    .select(['comment_id', 'last_read_at'])
    .where('user_email', '=', userEmail)
    .where(
      'comment_id',
      'in',
      threads.map((t) => t.id),
    )
    .execute();
  const readAtByComment = new Map(
    rows.map((r) => [r.comment_id, new Date(r.last_read_at).getTime()]),
  );

  for (const thread of threads) {
    const messages = [thread, ...(thread.replies || [])];
    const lastActivity = Math.max(
      ...messages.map((m) => new Date(m.createdAt).getTime()),
    );
    thread.lastActivityAt = new Date(lastActivity).toISOString();

    // Only activity from others can make a thread unread, and your own
    // later reply counts as an implicit read (you saw what you answered).
    const foreign = messages.filter((m) => m.author?.id !== userId);
    if (foreign.length === 0) {
      thread.unreadForUser = false;
      continue;
    }
    const lastForeign = Math.max(
      ...foreign.map((m) => new Date(m.createdAt).getTime()),
    );
    const own = messages.filter((m) => m.author?.id === userId);
    const lastOwn = own.length
      ? Math.max(...own.map((m) => new Date(m.createdAt).getTime()))
      : -Infinity;
    const readAt = readAtByComment.get(thread.id) ?? -Infinity;
    thread.unreadForUser = lastForeign > Math.max(readAt, lastOwn);
  }
}

/**
 * Author emails of everyone in a thread (the top-level comment + all its
 * replies), normalized and deduplicated. Used by the subscription resolver:
 * writing in a thread makes you a participant.
 *
 * @param {import('../scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} commentId - Top-level comment id (or a reply id; the
 *   thread is resolved via its parent)
 * @returns {Promise<string[]>}
 */
export async function getThreadParticipants(scope, commentId) {
  toStorageContext(scope, 'getThreadParticipants');
  const cid = norm(commentId);
  if (!cid) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);
    const root = await db
      .selectFrom('presentation_comments')
      .select(['id', 'parent_id', 'author_email'])
      .where('id', '=', cid)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();
    if (!root) return [];

    const rootId = root.parent_id || root.id;
    const rows = await db
      .selectFrom('presentation_comments')
      .select('author_email')
      .where('organization_id', '=', orgId)
      .where((eb) =>
        eb.or([eb('id', '=', rootId), eb('parent_id', '=', rootId)]),
      )
      .execute();

    return [
      ...new Set(
        rows.map((r) => normalizeEmail(r.author_email)).filter(Boolean),
      ),
    ];
  });
}

/**
 * Mark threads as read for the acting user (batch upsert of
 * `comment_thread_reads.last_read_at`). Only top-level comments of the given
 * presentation count; unknown/reply ids are ignored. No-op without an acting
 * user (guests have no read-state).
 *
 * @param {import('../scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} presentationId
 * @param {string[]} commentIds - Top-level comment ids to mark read
 * @returns {Promise<{ok: boolean, marked?: number, reason?: string}>}
 */
export async function markThreadsRead(scope, presentationId, commentIds) {
  toStorageContext(scope, 'markThreadsRead');
  const pid = norm(presentationId);
  const userEmail = normalizeEmail(scope?.actorEmail);
  if (!pid) return { ok: false, reason: 'invalid', field: 'presentation_id' };
  if (!userEmail) return { ok: true, marked: 0 };

  const ids = Array.isArray(commentIds)
    ? commentIds.map(norm).filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    : [];
  if (ids.length === 0) return { ok: true, marked: 0 };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    // Validate: only top-level comments of this presentation.
    const valid = await db
      .selectFrom('presentation_comments')
      .select('id')
      .where('presentation_id', '=', pid)
      .where('organization_id', '=', orgId)
      .where('parent_id', 'is', null)
      .where('id', 'in', ids)
      .execute();
    if (valid.length === 0) return { ok: true, marked: 0 };

    const now = nowIso();
    await db
      .insertInto('comment_thread_reads')
      .values(
        valid.map((row) => ({
          organization_id: orgId,
          user_email: userEmail,
          comment_id: row.id,
          last_read_at: now,
        })),
      )
      .onConflict((oc) =>
        oc
          .columns(['user_email', 'comment_id'])
          .doUpdateSet({ last_read_at: now }),
      )
      .execute();

    return { ok: true, marked: valid.length };
  });
}

/**
 * The most recent top-level comments across the decks a reader lists, newest
 * first, as one keyset page (B824, D358). Powers cross-deck review queries
 * ("latest comments on my decks", optionally by one reviewer) that the
 * per-deck {@link listComments} can't answer.
 *
 * Which decks those are is decided in the query: the deck a comment sits on
 * must be on the reader's deck list under `ownership`
 * (`deckListedCondition` in ./deck-list.js, the B820 predicate, B618). The
 * list used to be read in full in JavaScript and sent back as an `IN (...)`
 * of every deck id.
 *
 * @param {import('../scope.js').StorageScope} scope - The caller's org scope.
 * @param {Object} filter
 * @param {{userId?: string|null, email?: string, unrestricted?: boolean}} filter.reader
 *   The reader's identity (`listReader()`), its `userId` already resolved.
 * @param {'collection'|'owned'|'shared'|'all'} filter.ownership
 * @param {boolean} [filter.withoutOrganizationDecks=false] - Leave out
 *   organization-visible decks: they carry no comments while sharing is off
 *   (`presentationCommentsEnabled`).
 * @param {string|null} [filter.authorEmail] - Only this author's comments.
 * @param {'open'|'resolved'|'dismissed'|'all'} [filter.status='all']
 * @param {string|null} [filter.since] - ISO time; comments from then on.
 * @param {Object} page
 * @param {number} page.limit - Rows per page.
 * @param {{value: string, id: string}|null} [page.after] - Position of the
 *   last row seen.
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 *   Comments enriched with `presentationTitle`.
 */
export async function listRecentComments(
  scope,
  filter,
  { limit, after = null },
) {
  toStorageContext(scope, 'listRecentComments');
  const { reader, ownership } = filter || {};
  if (!reader || typeof reader !== 'object') {
    throw new TypeError('listRecentComments() requires a reader');
  }
  const authorEmail = filter.authorEmail
    ? normalizeEmail(filter.authorEmail)
    : null;
  const status = filter.status || 'all';

  return withDbGuard({ items: [], next: null }, async (db) => {
    const orgId = getOrgId(scope);
    let none = false;

    let query = db
      .selectFrom('presentation_comments')
      .innerJoin(
        'presentations',
        'presentations.id',
        'presentation_comments.presentation_id',
      )
      .selectAll('presentation_comments')
      .select('presentations.title as presentation_title')
      .where('presentation_comments.organization_id', '=', orgId)
      .where('presentation_comments.parent_id', 'is', null) // top-level only
      .where((eb) => {
        const listed = deckListedCondition(scope, eb, { reader, ownership });
        if (listed) return listed;
        none = true;
        return eb.lit(false);
      });
    if (none) return { items: [], next: null };

    if (filter.withoutOrganizationDecks) {
      query = query.where(
        'presentations.visibility',
        'is distinct from',
        'organization',
      );
    }
    if (authorEmail) {
      query = query.where(
        'presentation_comments.author_email',
        '=',
        authorEmail,
      );
    }
    if (status !== 'all') {
      query = query.where('presentation_comments.status', '=', status);
    }
    if (filter.since) {
      query = query.where(
        'presentation_comments.created_at',
        '>=',
        filter.since,
      );
    }

    const { rows, next } = keysetRows(
      await keysetPage(query, {
        column: 'presentation_comments.created_at',
        idColumn: 'presentation_comments.id',
        after,
        limit,
      }).execute(),
      limit,
    );

    const ctx = await commentReadContext(rows, scope);
    const items = rows.map(({ presentation_title: title, ...row }) => {
      const comment = rowToComment(row, ctx);
      comment.presentationTitle = title || 'Untitled';
      return comment;
    });
    return { items, next };
  });
}

/**
 * The address a comment was written under — **server-side only**.
 *
 * A comment names its author (`author: { id, displayName }`) and hands out no
 * address (D22). The notification fan-out still needs one: a reply has to reach
 * the person it answers, and that person may be a share-link guest with no
 * `users` row to resolve an address from. So the address is fetched here, by
 * comment id, by the layer that sends the mail — and never travels back to a
 * client. See services/comment-notifications.js.
 *
 * @param {import('../scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} commentId
 * @returns {Promise<string>} The stored address, or '' when there is no such comment.
 */
export async function getCommentAuthorEmail(scope, commentId) {
  toStorageContext(scope, 'getCommentAuthorEmail');
  const cid = norm(commentId);
  if (!cid) return '';
  return withDbGuard('', async (db) => {
    const row = await db
      .selectFrom('presentation_comments')
      .select('author_email')
      .where('id', '=', cid)
      .where('organization_id', '=', getOrgId(scope))
      .executeTakeFirst();
    return normalizeEmail(row?.author_email) || '';
  });
}

/**
 * Get a single comment by ID.
 */
export async function getComment(scope, commentId) {
  toStorageContext(scope, 'getComment');
  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(scope);

    const row = await db
      .selectFrom('presentation_comments')
      .selectAll()
      .where('id', '=', commentId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!row) return null;

    // Fetch replies if this is a top-level comment
    const replyRows = row.parent_id
      ? []
      : await db
          .selectFrom('presentation_comments')
          .selectAll()
          .where('parent_id', '=', commentId)
          .where('organization_id', '=', orgId)
          .orderBy('created_at', 'asc')
          .execute();

    const ctx = await commentReadContext([row, ...replyRows], scope);
    const comment = rowToComment(row, ctx);
    if (!row.parent_id) {
      comment.replies = replyRows.map((reply) => rowToComment(reply, ctx));
    }

    return comment;
  });
}

/**
 * Create a new comment or reply.
 */
export async function createComment(scope, presentationId, data) {
  return withContentTransaction(
    getOrgId(toStorageContext(scope, 'createComment')),
    async () => {
      toStorageContext(scope, 'createComment');
      const pid = norm(presentationId);
      const authorEmail = normalizeEmail(data?.email || scope?.actorEmail);
      const authorName = norm(data?.name) || authorEmail;
      const body = norm(data?.body);
      // A share-link guest is identified by their guest row, not by an address:
      // they have no `users` row and never will (migration 079).
      const authorGuestId = data?.guestId || null;

      if (!pid || !authorEmail || !body) {
        return { ok: false, reason: 'invalid' };
      }

      // Dual-write the stable key beside the address, the way every other stamp
      // does (storage/identity-resolver.js). A guest, or an address with no user
      // row, resolves to a defined NULL.
      const authorUserId = authorGuestId
        ? null
        : ((await resolveIdentityByEmail(scope, authorEmail))?.userId ?? null);

      return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
        const orgId = getOrgId(scope);
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
        const positionX =
          typeof data?.positionX === 'number' ? data.positionX : null;
        const positionY =
          typeof data?.positionY === 'number' ? data.positionY : null;

        // AI suggestion fields
        const commentType = data?.commentType || 'human';
        const suggestionCategory = data?.suggestionCategory || null;
        const proposedSlide = data?.proposedSlide || null;

        // Snapshot of the commented slide at create time (see migration 041);
        // captured by the caller, only meaningful for comments with a slideId.
        const slideSnapshot =
          data?.slideId && data?.slideSnapshot ? data.slideSnapshot : null;

        await assertCurrentCustomFields(
          scope,
          slideSnapshot ? [slideSnapshot] : [],
        );
        const row = await db
          .insertInto('presentation_comments')
          .values({
            presentation_id: pid,
            organization_id: orgId,
            slide_id: data?.slideId || null,
            parent_id: parentId,
            author_email: authorEmail,
            author_name: authorName,
            author_user_id: authorUserId,
            author_guest_id: authorGuestId,
            body: body,
            status: 'open',
            position_x: positionX,
            position_y: positionY,
            comment_type: commentType,
            suggestion_category: suggestionCategory,
            proposed_slide: proposedSlide
              ? JSON.stringify(proposedSlide)
              : null,
            slide_snapshot: slideSnapshot
              ? JSON.stringify(slideSnapshot)
              : null,
            // Parsed from the body markup here — single source of truth for
            // every write path (app, public API v1, MCP).
            mentions: JSON.stringify(parseMentions(body)),
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirst();

        return {
          ok: true,
          comment: rowToComment(row, await commentReadContext([row], scope)),
        };
      });
    },
  );
}

/**
 * Update a comment's body.
 * Only the author can update.
 */
export async function updateComment(scope, commentId, data) {
  toStorageContext(scope, 'updateComment');
  const body = norm(data?.body);
  if (!body) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const row = await db
      .updateTable('presentation_comments')
      .set({
        body: body,
        mentions: JSON.stringify(parseMentions(body)),
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
      comment: rowToComment(row, await commentReadContext([row], scope)),
    };
  });
}

/**
 * Resolve a comment (mark as resolved).
 * Only presentation owner/admin can resolve.
 */
export async function resolveComment(scope, commentId, { email } = {}) {
  toStorageContext(scope, 'resolveComment');
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();
    const resolverEmail = normalizeEmail(email);

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
      comment: rowToComment(row, await commentReadContext([row], scope)),
    };
  });
}

/**
 * Reopen a resolved comment.
 */
export async function reopenComment(scope, commentId) {
  toStorageContext(scope, 'reopenComment');
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
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
      comment: rowToComment(row, await commentReadContext([row], scope)),
    };
  });
}

/**
 * Dismiss an AI suggestion (different from resolve).
 * Sets status to 'dismissed' for AI suggestions.
 */
export async function dismissComment(scope, commentId, { email } = {}) {
  toStorageContext(scope, 'dismissComment');
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();
    const dismisserEmail = normalizeEmail(email);

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
      comment: rowToComment(row, await commentReadContext([row], scope)),
    };
  });
}

/**
 * Delete a comment.
 * Cascades to replies via FK constraint.
 */
export async function deleteComment(scope, commentId) {
  toStorageContext(scope, 'deleteComment');
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

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
export async function getOpenCommentCount(scope, presentationId) {
  toStorageContext(scope, 'getOpenCommentCount');
  const pid = norm(presentationId);
  if (!pid) return 0;

  return withDbGuard(0, async (db) => {
    const orgId = getOrgId(scope);

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
export async function getCommentCountsBySlide(scope, presentationId) {
  toStorageContext(scope, 'getCommentCountsBySlide');
  const pid = norm(presentationId);
  if (!pid) return {};

  return withDbGuard({}, async (db) => {
    const orgId = getOrgId(scope);

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

/**
 * The author pair of a comment row.
 *
 * The id half is the row's own column; the name half prefers the author's
 * current profile name, then the name stored on the row, then one derived from
 * the address. The stored name matters for a share-link guest: they have no
 * profile to resolve, and `author_name` is the name they gave when they
 * verified — deriving one from their address would throw it away.
 *
 * @param {object} row - Database row
 * @param {import('../display-identity.js').DisplayNameLookup} lookup
 * @returns {import('../display-identity.js').DisplayIdentity|null}
 */
function commentAuthor(row, lookup) {
  const identity = toDisplayIdentity(
    row.author_user_id,
    row.author_email,
    lookup,
  );
  if (!identity) return null;
  const profileName =
    lookup.forId(row.author_user_id) || lookup.forEmail(row.author_email);
  const stored = String(row.author_name || '').trim();
  if (!profileName && stored && !stored.includes('@')) {
    identity.displayName = stored;
  }
  return identity;
}

/**
 * Map a comment row to the object a response carries.
 *
 * @param {object} row - Database row
 * @param {CommentReadContext} [ctx] - What the batch resolved: display names
 *   and the instance's AI author address.
 * @returns {object}
 */
function rowToComment(row, ctx = NO_COMMENT_CONTEXT) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    slideId: row.slide_id,
    parentId: row.parent_id,
    // Who wrote it, named rather than addressed (D22). The `id` is the key the
    // edit/delete checks compare — `users.id` for a signed-in author, null for
    // a guest, who is keyed by `authorGuestId` instead (migration 079).
    author: commentAuthor(row, ctx.lookup),
    authorGuestId: row.author_guest_id || null,
    // Whether the instance's AI assistant wrote it. The client used to derive
    // this by comparing the configured AI address against `authorEmail`; the
    // address no longer travels, so the answer does.
    isAi: ctx.isAi(row.author_email),
    body: row.body,
    status: row.status,
    // Who resolved it: this column never got an id half, so the id comes from
    // the same lookup that resolved the name (storage/display-identity.js).
    resolvedBy: toStoredActorIdentity(row.resolved_by, null, ctx.lookup),
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    positionX: row.position_x ?? null,
    positionY: row.position_y ?? null,
    commentType: row.comment_type ?? 'human',
    suggestionCategory: row.suggestion_category ?? null,
    proposedSlide: row.proposed_slide ?? null,
    slideSnapshot: row.slide_snapshot ?? null,
    mentions: row.mentions ?? [], // Pre-migration rows read as no mentions
    replies: [], // Populated separately
  };
}
