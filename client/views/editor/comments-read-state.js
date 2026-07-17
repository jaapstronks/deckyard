/**
 * Pure helpers for the per-user comment read-state (phase 2 of the comments
 * & notifications plan). No DOM, no fetches — unit-testable.
 *
 * The server annotates top-level comments with `unreadForUser` (someone
 * else's activity newer than your last-read) and `lastActivityAt`. "Waiting
 * for me" is a client-side heuristic on the same data: the thread's latest
 * message is not yours, so the ball is in your court. It is a filter, not a
 * status — nothing is stored.
 */

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

/**
 * The author email of the latest message in a thread (top-level comment or
 * newest reply). Replies arrive sorted oldest→newest from the server, but
 * sort defensively on createdAt anyway.
 * @param {Object} thread - Top-level comment with `replies`
 * @returns {string} normalized email ('' if unknown)
 */
export function lastMessageAuthor(thread) {
  const replies = Array.isArray(thread?.replies) ? thread.replies : [];
  if (replies.length === 0) return normEmail(thread?.authorEmail);
  let last = replies[0];
  for (const r of replies) {
    if (new Date(r?.createdAt || 0) >= new Date(last?.createdAt || 0)) last = r;
  }
  return normEmail(last?.authorEmail);
}

/**
 * Does this thread wait for the given user? True when the thread is open
 * and the latest message is from someone else.
 * @param {Object} thread - Top-level comment with `replies` and `status`
 * @param {string} userEmail - Current user's email
 * @returns {boolean}
 */
export function threadWaitsFor(thread, userEmail) {
  const me = normEmail(userEmail);
  if (!me) return false;
  if (thread?.status !== 'open') return false;
  const last = lastMessageAuthor(thread);
  return !!last && last !== me;
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
