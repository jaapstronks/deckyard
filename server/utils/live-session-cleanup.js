/**
 * Periodic TTL sweep for the live-session domains.
 *
 * Present sessions and follow codes are 24h ephemera. While they lived on disk
 * nothing collected them: `cleanupExpiredCodes()` existed but was never called,
 * and an expired session file was only removed if the process that wrote it
 * happened to read the directory again. Both are rows now, so collecting them
 * is a `DELETE` on a schedule — the same shape as the sandbox sweep
 * (`sandbox-cleanup.js`), which is the precedent this follows.
 *
 * This complements, not replaces, the in-memory expiry timer in
 * `storage/present-sessions/sessions.js`: that one also has to close the
 * session's SSE clients, so it stays responsible for the sessions *this*
 * process holds. The sweep is for the rows nobody holds — a worker that died,
 * a redeploy, a presenter who never closed the tab.
 */

import { cleanupExpiredCodes } from '../storage/follow-codes.js';
import { sweepExpiredSessions } from '../storage/present-sessions/db.js';
import { createLogger } from './logger.js';

const log = createLogger('live-session-cleanup');

/**
 * Delete every expired present session and follow code, once.
 *
 * Sessions go first: interactions, questions and feedback are foreign-keyed to
 * `present_sessions.session_id` with ON DELETE CASCADE, so once those domains
 * move to the database (PR 5 of the disk-JSON track) this ordering collects
 * them in the same statement.
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
