/**
 * Pure helpers for the per-user comment read-state (phase 2 of the comments
 * & notifications plan). No DOM, no fetches — unit-testable.
 *
 * The server annotates top-level comments with `unreadForUser` (someone
 * else's activity newer than your last-read) and `lastActivityAt`. "Waiting
 * for me" is a client-side heuristic on the same data: the thread's latest
 * message is not yours, so the ball is in your court. It is a filter, not a
 * status — nothing is stored.
 *
 * Who wrote a message is read off `author.id` — a comment names its author and
 * carries no address (D22; see docs/reference/identity-in-responses.md).
 */

/**
 * The author id of the latest message in a thread (top-level comment or
 * newest reply). Replies arrive sorted oldest→newest from the server, but
 * sort defensively on createdAt anyway.
 * @param {Object} thread - Top-level comment with `replies`
 * @returns {string} `users.id` ('' if unknown, e.g. a guest author)
 */
export function lastMessageAuthor(thread) {
  const replies = Array.isArray(thread?.replies) ? thread.replies : [];
  if (replies.length === 0) return thread?.author?.id || '';
  let last = replies[0];
  for (const r of replies) {
    if (new Date(r?.createdAt || 0) >= new Date(last?.createdAt || 0)) last = r;
  }
  return last?.author?.id || '';
}

/**
 * Does this thread wait for the given user? True when the thread is open
 * and the latest message is from someone else.
 * @param {Object} thread - Top-level comment with `replies` and `status`
 * @param {string} userId - Current user's `users.id`
 * @returns {boolean}
 */
export function threadWaitsFor(thread, userId) {
  if (!userId) return false;
  if (thread?.status !== 'open') return false;
  const last = lastMessageAuthor(thread);
  return !!last && last !== userId;
}

/**
 * Ids of threads the server marked unread for the current user.
 * @param {Array<Object>} threads
 * @returns {string[]}
 */
export function collectUnreadThreadIds(threads) {
  return (Array.isArray(threads) ? threads : [])
    .filter((t) => t?.unreadForUser === true)
    .map((t) => t.id)
    .filter(Boolean);
}
