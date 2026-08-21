import { sseWrite } from '../../utils/sse.js';
import { closeQuestionsClients } from '../questions.js';
import { sessions } from './state.js';
import { deletePersistedSession } from './db.js';
import { fireAndForget } from '../../utils/fire-and-forget.js';

/**
 * End a session: tell its SSE clients, stop its timers, drop it from this
 * process, and delete its row.
 *
 * Deleting the row cascades the session's questions, interactions, votes and
 * feedback away with it. The question feed keeps its own SSE streams (they
 * attach to a different endpoint), so those are closed here too — otherwise a
 * follower would sit on a feed whose data no longer exists.
 *
 * @param {string} sessionId
 * @param {string} [reason] - Sent to clients as the close reason.
 * @returns {boolean} Whether a session was held here to close.
 */
export function closeSession(sessionId, reason = 'closed') {
  const s = sessions.get(String(sessionId || '')) || null;
  if (!s) return false;
  closeQuestionsClients(sessionId, reason);
  for (const res of Array.from(s.clients)) {
    try {
      sseWrite(res, { event: 'close', data: { reason } });
    } catch {}
    try {
      res.end?.();
    } catch {}
  }
  if (s.persistTimer) {
    try {
      clearTimeout(s.persistTimer);
    } catch {}
  }
  sessions.delete(sessionId);
  fireAndForget(
    deletePersistedSession(sessionId),
    'live-session persisted-row delete',
  );
  return true;
}
