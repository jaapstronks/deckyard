import { sseWrite } from '../../utils/sse.js';
import { sessions } from './state.js';
import { deletePersistedSession } from './db.js';

/**
 * End a session: tell its SSE clients, stop its timers, drop it from this
 * process, and delete its row.
 *
 * @param {string} sessionId
 * @param {string} [reason] - Sent to clients as the close reason.
 * @returns {boolean} Whether a session was held here to close.
 */
export function closeSession(sessionId, reason = 'closed') {
  const s = sessions.get(String(sessionId || '')) || null;
  if (!s) return false;
  for (const res of Array.from(s.clients)) {
    try {
      sseWrite(res, { event: 'close', data: { reason } });
    } catch {}
    try {
      res.end?.();
    } catch {}
  }
  for (const tid of s.heartbeatTimers.values()) {
    try {
      clearInterval(tid);
    } catch {}
  }
  if (s.persistTimer) {
    try {
      clearTimeout(s.persistTimer);
    } catch {}
  }
  sessions.delete(sessionId);
  deletePersistedSession(sessionId).catch(() => {});
  return true;
}
