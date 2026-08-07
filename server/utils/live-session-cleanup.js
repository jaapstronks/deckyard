/**
 * Periodic TTL sweep for the live-session domains.
 *
 * Live sessions and follow codes are 24h ephemera. While they lived on disk
 * nothing collected them: `cleanupExpiredCodes()` existed but was never called,
 * and an expired session file was only removed if the process that wrote it
 * happened to read the directory again. Both are rows now, so collecting them
 * is a `DELETE` on a schedule — the same shape as the sandbox sweep
 * (`sandbox-cleanup.js`), which is the precedent this follows.
 *
 * This complements, not replaces, the in-memory expiry timer in
 * `storage/live-sessions/sessions.js`: that one also has to close the
 * session's SSE clients, so it stays responsible for the sessions *this*
 * process holds. The sweep is for the rows nobody holds — a worker that died,
 * a redeploy, a presenter who never closed the tab.
 *
 * Since PR 5 of the disk-JSON track this sweep also collects the audience-side
 * domains — questions, interactions, votes and feedback — without a statement
 * of its own. Each of those tables foreign-keys `session_id` to
 * `present_sessions` with `ON DELETE CASCADE`, so deleting the session takes
 * them along. That is deliberate rather than incidental: those domains used to
 * have TTL logic of their own that either never ran (`interactions.js` and
 * `feedback.js` left expired sessions "on disk for now", growing forever) or
 * duplicated the session's own clock (`questions.js` ran a second 24h timer).
 * One lifetime, one owner. `tests/pg/live-interactions.pgtest.js` asserts the
 * cascade rather than trusting it.
 */

import { cleanupExpiredCodes } from '../storage/follow-codes.js';
import { sweepExpiredSessions } from '../storage/live-sessions/db.js';
import { createLogger } from './logger.js';

const log = createLogger('live-session-cleanup');

/**
 * Delete every expired live session and follow code, once.
 *
 * Sessions go first: interactions, questions and feedback are foreign-keyed to
 * `present_sessions.session_id` with ON DELETE CASCADE, so this one statement
 * collects them too.
 *
 * @returns {Promise<{ sessions: number, followCodes: number }>}
 */
export async function sweepExpiredLiveSessions() {
  const sessions = await sweepExpiredSessions();
  const followCodes = await cleanupExpiredCodes();
  return { sessions, followCodes };
}

/**
 * Start the periodic sweep.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs] - Sweep interval (min 60s).
 * @returns {() => void} Stop function.
 */
export function startLiveSessionCleanupLoop({ intervalMs = 15 * 60 * 1000 } = {}) {
  let stopped = false;
  let running = false;

  async function sweep() {
    if (stopped || running) return;
    running = true;
    try {
      const { sessions, followCodes } = await sweepExpiredLiveSessions();
      if (sessions > 0 || followCodes > 0) {
        log.info(`swept ${sessions} expired session(s) and ${followCodes} follow code(s)`);
      }
    } catch (err) {
      // Best-effort: a sweep that fails (DB blip) simply retries next interval.
      log.warn(`live-session sweep failed: ${err?.message || err}`);
    } finally {
      running = false;
    }
  }

  // Run immediately, then on interval.
  sweep();
  const t = setInterval(sweep, Math.max(60_000, Number(intervalMs) || 15 * 60 * 1000));
  t.unref?.();
  return () => {
    stopped = true;
    try {
      clearInterval(t);
    } catch {
      // ignore
    }
  };
}
