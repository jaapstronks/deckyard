/**
 * Comments — the one place a comment is created, and the one place its status
 * changes, on every contract (A7.4, B518, B569).
 *
 * The internal `/api` route (`routes/api/presentations/comments-write.js`), the
 * public v1 route (`routes/public-api/v1/comments.js`) and the MCP tools
 * `add_comment` / `reply_to_comment` (`mcp/tools.js`) each used to carry their
 * own copy of this flow, and the copies had drifted: the internal route stored
 * no slide snapshot, only v1 refused a parent on another deck before the insert,
 * only MCP folded a reply-to-a-reply into its thread, and MCP notified in-app
 * only, so nobody got an e-mail about an agent's comment. Now each contract
 * parses its input, resolves its own identity, calls {@link createComment} and
 * renders the answer in its envelope; everything a comment *is* lives here
 * (brief `one-service-layer.md`, D252–D254).
 *
 * The service owns:
 *
 *   - **who may comment** — decided by `loadPresentationForActor` with
 *     `access: 'comment'` (an actor through the collaborator-aware deciders, a
 *     share-link guest through `canGuestComment`);
 *   - **what a comment is** — a non-empty body of at most
 *     {@link MAX_COMMENT_LENGTH} characters, a slide anchor that names a slide
 *     of the deck (and is stored with a snapshot of it), a parent on the same
 *     deck, folded to its thread root (threads are one level deep);
 *   - **what happens after** — the notification fan-out (the subscription
 *     resolver decides who hears, whichever contract asked), the activity row
 *     and the live broadcast, all fire-and-forget.
 *
 * A comment's status changes in one place too ({@link setCommentStatus}, B569).
 * The internal resolve/reopen/dismiss routes, v1 `POST /comments/:id/status`
 * and MCP `set_comment_status` each loaded, decided and announced on their own:
 * the internal route decided on the session user, the other two on the actor,
 * and each answered a status the comment was not in with its own status code.
 *
 * Failures are thrown as `AppError`s (D254); each contract's error handler
 * renders them. Absent deck → 404, no comment right → 403 (D255).
 *
 * @module server/services/comments
 */

import {
  getComment,
  createComment as storeComment,
  resolveComment,
  reopenComment,
  dismissComment,
  getOpenCommentCount,
  getCommentCountsBySlide,
} from '../storage/presentations/comments.js';
import { repoRootOf } from '../storage/scope.js';
import {
  AppError,
  NotFoundError,
  ValidationError,
  throwStorageFailure,
} from '../utils/errors.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import { createLogger } from '../utils/logger.js';
import { buildSlideSnapshot } from './comment-slide-context.js';
import { notifyCommentCreated } from './comment-notifications.js';
import {
  recordCommentCreated,
  recordCommentResolved,
  recordCommentReopened,
} from './activity-events.js';
import { loadPresentationForActor } from './presentations.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from './comment-events.js';

const log = createLogger('comments');

/** Maximum length of a comment body, in characters. */
export const MAX_COMMENT_LENGTH = 5000;

/**
 * @typedef {import('./actor.js').ServiceIdentity} ServiceIdentity
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/**
 * Create a comment, or a reply when `parentId` is given.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {ServiceIdentity} identity - `{ actor }`, or `{ guest, shareLink }`
 *   for a share-link guest (internal contract only).
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {*} input.body - The comment text; trimmed here.
 * @param {string|null} [input.slideId] - Anchor to this slide of the deck.
 * @param {string|null} [input.parentId] - Reply to this comment (or to its
 *   thread, when it is itself a reply).
 * @param {number} [input.positionX] - Pin position on the slide, percent.
 * @param {number} [input.positionY] - Pin position on the slide, percent.
 * @returns {Promise<{ comment: Object, presentation: Object }>}
 * @throws {import('../utils/errors.js').AppError}
 */
export async function createComment(
  scope,
  identity,
  {
    presentationId,
    body,
    slideId = null,
    parentId = null,
    positionX,
    positionY,
  },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'comment',
  });
  const author = authorOf(identity);

  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new ValidationError('Comment body is required');
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new ValidationError(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or less`,
    );
  }

  const slideSnapshot = snapshotOfSlide(pres, slideId);
  const parentComment = await threadRoot(scope, pres.id, parentId);

  const result = await storeComment(scope, pres.id, {
    email: author.email,
    name: author.name,
    // A guest is keyed on their guest row (migration 079): without this id the
    // comment would be nobody's, and the guest could never edit or delete it.
    guestId: author.guestId,
    body: text,
    slideId: slideId || null,
    parentId: parentComment?.id || null,
    positionX,
    positionY,
    slideSnapshot,
  });
  if (!result.ok) {
    throwStorageFailure(result, `Could not create comment: ${result.reason}`);
  }

  announceCommentCreated(scope, {
    presentation: pres,
    comment: result.comment,
    parentComment,
    author,
  });

  return { comment: result.comment, presentation: pres };
}

/**
 * What each status a comment can be moved to means: the storage transition
 * that moves it there (the transition also refuses a comment not in the state
 * it leaves), the activity it leaves, and the live event the deck hears.
 * Dismissing is resolving an AI suggestion without acting on it: clients see
 * it leave the open list, the activity feed does not record it.
 */
const STATUS_CHANGES = Object.freeze({
  resolved: {
    store: (scope, id, actor) =>
      resolveComment(scope, id, { email: actor.email }),
    record: recordCommentResolved,
    event: CommentEventTypes.RESOLVED,
  },
  open: {
    store: (scope, id) => reopenComment(scope, id),
    record: recordCommentReopened,
    event: CommentEventTypes.REOPENED,
  },
  dismissed: {
    store: (scope, id, actor) =>
      dismissComment(scope, id, { email: actor.email }),
    record: null,
    event: CommentEventTypes.RESOLVED,
  },
});

/** The statuses {@link setCommentStatus} moves a comment to. */
export const COMMENT_STATUSES = Object.freeze(Object.keys(STATUS_CHANGES));

/**
 * Move a comment to a new status: resolve it, reopen it, or dismiss it.
 *
 * Moderation is the deck's owner or creator, or an organization admin acting in
 * a session (`access: 'moderate'`). The transitions are open→resolved,
 * open→dismissed and resolved→open; any other is refused by the storage
 * transition with its reason code (400), on every contract.
 *
 * The comment is addressed under its deck where the contract addresses it that
 * way (internal, MCP): the deck is loaded and decided first, so a deck the
 * caller may not moderate betrays none of its comment ids, and a comment on
 * another deck is absent. v1 addresses the comment alone (`/comments/:id/status`)
 * and leaves `presentationId` out; the comment then names its deck.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: import('./actor.js').Actor }} identity - Only an actor
 *   moderates; a share-link guest never does.
 * @param {Object} input
 * @param {string} input.commentId
 * @param {*} input.status - One of {@link COMMENT_STATUSES}.
 * @param {string|null} [input.presentationId] - The deck the contract
 *   addressed the comment under.
 * @returns {Promise<{ comment: Object, presentation: Object }>}
 * @throws {import('../utils/errors.js').AppError}
 */
export async function setCommentStatus(
  scope,
  identity,
  { commentId, status, presentationId = null },
) {
  const change = Object.hasOwn(STATUS_CHANGES, status)
    ? STATUS_CHANGES[status]
    : null;
  if (!change) {
    throw new AppError(
      `Invalid status (${COMMENT_STATUSES.join('|')})`,
      400,
      { field: 'status' },
      'invalid',
    );
  }

  let pres;
  let comment;
  if (presentationId) {
    pres = await loadPresentationForActor(scope, identity, presentationId, {
      access: 'moderate',
    });
    comment = await commentOn(scope, pres.id, commentId);
  } else {
    comment = await commentOn(scope, null, commentId);
    pres = await loadPresentationForActor(
      scope,
      identity,
      comment.presentationId,
      { access: 'moderate' },
    );
  }

  const { actor } = identity;
  const result = await change.store(scope, comment.id, actor);
  if (!result.ok) {
    throwStorageFailure(result, `Could not change status: ${result.reason}`);
  }

  if (change.record) {
    fireAndForget(
      change.record({
        comment: result.comment,
        presentation: pres,
        actor,
        scope,
      }),
      `record comment-${status} activity`,
    );
  }
  broadcastToPresentation(pres.id, change.event, { comment: result.comment });
  fireAndForget(
    broadcastCommentCounts(pres.id, scope),
    'broadcast comment counts',
  );

  return { comment: result.comment, presentation: pres };
}

/**
 * Broadcast the current comment counts to every client on the deck. Called
 * after any comment mutation (create/update/delete/resolve/reopen/dismiss).
 *
 * @param {string} presentationId
 * @param {StorageScope} scope
 * @returns {Promise<void>}
 */
export async function broadcastCommentCounts(presentationId, scope) {
  try {
    const counts = await getCommentCountsBySlide(scope, presentationId);
    const total = await getOpenCommentCount(scope, presentationId);
    broadcastToPresentation(presentationId, CommentEventTypes.COUNTS_CHANGED, {
      counts,
      total,
    });
  } catch (err) {
    // A missed count update is cosmetic: the next mutation or reload corrects it.
    log.warn('comment count broadcast failed:', err?.message || err);
  }
}

/**
 * Name the author of a comment the identity may write (the right is decided in
 * {@link loadPresentationForActor}).
 *
 * @param {ServiceIdentity} identity
 * @returns {{ email: string, name: string|undefined, guestId: string|null, isGuest: boolean }}
 */
function authorOf(identity) {
  if ('guest' in identity) {
    const { guest } = identity;
    return {
      email: guest.email,
      name: guest.name,
      guestId: guest.id,
      isGuest: true,
    };
  }
  const { actor } = identity;
  return {
    email: actor.email,
    name: actor.name,
    guestId: null,
    isGuest: false,
  };
}

/**
 * The comment with this id, on this deck when one is named; absent otherwise.
 *
 * @param {StorageScope} scope
 * @param {string|null} presentationId
 * @param {string} commentId
 * @returns {Promise<Object>}
 * @throws {NotFoundError}
 */
async function commentOn(scope, presentationId, commentId) {
  const comment = commentId ? await getComment(scope, commentId) : null;
  if (
    !comment ||
    (presentationId && comment.presentationId !== presentationId)
  ) {
    throw new NotFoundError('Comment not found');
  }
  return comment;
}

/**
 * The create-time snapshot of the anchored slide; `null` without an anchor.
 * An anchor that names no slide of the deck is refused, on every contract.
 *
 * @param {Object} pres
 * @param {string|null} slideId
 * @returns {Object|null}
 */
function snapshotOfSlide(pres, slideId) {
  if (!slideId) return null;
  const slide = (pres.slides || []).find((s) => s?.id === slideId);
  if (!slide) {
    throwStorageFailure(
      { ok: false, reason: 'slide_not_found' },
      'Slide not found in this presentation',
    );
  }
  return buildSlideSnapshot(slide);
}

/**
 * The comment a reply attaches to: the parent, or — when the parent is itself
 * a reply — the top of its thread. A parent on another deck is as absent as
 * one that does not exist.
 *
 * @param {StorageScope} scope
 * @param {string} presentationId
 * @param {string|null} parentId
 * @returns {Promise<Object|null>}
 */
async function threadRoot(scope, presentationId, parentId) {
  if (!parentId) return null;
  const parent = await getComment(scope, parentId);
  if (!parent || parent.presentationId !== presentationId) {
    throwStorageFailure(
      { ok: false, reason: 'parent_not_found' },
      'Parent comment not found on this presentation',
    );
  }
  if (!parent.parentId) return parent;
  const root = await getComment(scope, parent.parentId);
  if (!root) {
    throwStorageFailure(
      { ok: false, reason: 'parent_not_found' },
      'Parent comment not found on this presentation',
    );
  }
  return root;
}

/**
 * The side effects of a new comment, fire-and-forget: the response never waits
 * on notification plumbing.
 */
function announceCommentCreated(
  scope,
  { presentation, comment, parentComment, author },
) {
  const actor = { email: author.email, name: author.name };

  fireAndForget(
    notifyCommentCreated(repoRootOf(scope), {
      presentation,
      comment,
      parentComment,
      actor,
      scope,
    }),
    'comment-created notification fan-out',
  );
  fireAndForget(
    recordCommentCreated({
      comment,
      presentation,
      actor,
      isGuest: author.isGuest,
      scope,
    }),
    'record comment-created activity',
  );
  broadcastToPresentation(presentation.id, CommentEventTypes.CREATED, {
    comment,
  });
  fireAndForget(
    broadcastCommentCounts(presentation.id, scope),
    'broadcast comment counts',
  );
}
