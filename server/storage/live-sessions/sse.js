import { sseComment, sseWrite } from '../../utils/sse.js';
import { HEARTBEAT_MS } from './constants.js';
import { schedulePersist } from './db.js';
import { sessions } from './state.js';
import { touchLiveSession, findMostRecentSessionForPresentation } from './sessions.js';

export async function attachSessionSseClient(repoRoot, sessionId, res) {
  const s = await touchLiveSession(repoRoot, sessionId);
  if (!s) return null;

  s.clients.add(res);

  // Initial snapshot
  sseWrite(res, { event: 'state', data: s.state });
  sseWrite(res, {
    event: 'controlEnabled',
    data: { controlEnabled: !!s.controlEnabled, updatedAt: Date.now() },
  });

  // Heartbeats
  const tid = setInterval(() => {
    sseComment(res, 'heartbeat');
  }, HEARTBEAT_MS);
  s.heartbeatTimers.set(res, tid);

  const detach = () => {
    try {
      clearInterval(tid);
    } catch {}
    try {
      s.heartbeatTimers.delete(res);
    } catch {}
    try {
      s.clients.delete(res);
    } catch {}
  };

  res.on?.('close', detach);
  res.on?.('finish', detach);
  return detach;
}

/**
 * Send an event to the session's SSE clients **in this process**.
 *
 * Deliberately a memory-only lookup: the clients are process-local sockets, so
 * a session this process is not holding has nobody here to write to and the
 * table has nothing to add. (Reaching followers attached to another worker
 * needs a pub/sub substrate — see the note in `db.js`.)
 *
 * @returns {Promise<boolean>} Whether a local session was found to broadcast to.
 */
export async function broadcast(repoRoot, sessionId, event, data) {
  const s = getSessionSync(sessionId);
  if (!s) return false;
  touchSessionSync(s);
  // Serialize once for all clients; sseWrite passes strings through as-is.
  const payload =
    data == null || typeof data === 'string' ? data : JSON.stringify(data);
  for (const res of Array.from(s.clients)) {
    try {
      sseWrite(res, { event, data: payload });
    } catch {
      // Drop broken connections eagerly
      try {
        s.clients.delete(res);
      } catch {}
    }
  }
  return true;
}

export async function notifyLiveSessionInteractionState(repoRoot, sessionId, interactionState) {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  return broadcast(repoRoot, sid, 'interactionState', {
    ...(interactionState && typeof interactionState === 'object' ? interactionState : {}),
    updatedAt: Date.now(),
  });
}

export function notifyLiveSessionDeckUpdated(
  repoRoot,
  sessionId,
  { presentationId = '', slideId = '', reason = 'deck_updated' } = {}
) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, reason: 'missing_sessionId' };
  const payload = {
    presentationId: String(presentationId || '').trim(),
    slideId: String(slideId || '').trim(),
    reason: String(reason || 'deck_updated'),
    updatedAt: Date.now(),
  };
  broadcast(repoRoot, sid, 'deckUpdated', payload).catch(() => {});
  return { ok: true };
}

/**
 * Notify the live session (if any) for a presentation that its deck changed.
 * Resolves the most recent session for the presentation and broadcasts
 * `deckUpdated` to its clients; a no-op when nothing is being presented.
 */
export async function notifyDeckUpdatedForPresentation(
  repoRoot,
  presentationId,
  { slideId = '', reason = 'deck_updated' } = {}
) {
  const pid = String(presentationId || '').trim();
  if (!pid) return { ok: false, reason: 'missing_presentationId' };
  const s = await findMostRecentSessionForPresentation(repoRoot, pid);
  if (!s?.sessionId || !s.clients?.size) return { ok: false, reason: 'no_live_session' };
  return notifyLiveSessionDeckUpdated(repoRoot, s.sessionId, {
    presentationId: pid,
    slideId,
    reason,
  });
}

export function broadcastBranch(
  repoRoot,
  sessionId,
  { slideId = '', onClose = 'stay', onCloseTarget = '' } = {}
) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, reason: 'missing_sessionId' };
  const payload = {
    slideId: String(slideId || '').trim(),
    onClose: String(onClose || 'stay').trim(),
    onCloseTarget: String(onCloseTarget || '').trim(),
    updatedAt: Date.now(),
  };
  broadcast(repoRoot, sid, 'branch', payload).catch(() => {});
  return { ok: true };
}

export async function updateLiveSessionState(repoRoot, sessionId, nextState) {
  const s = await touchLiveSession(repoRoot, sessionId);
  if (!s) return null;
  const slideId = typeof nextState?.slideId === 'string' ? nextState.slideId : '';
  const slideIndex = Number(nextState?.slideIndex || 0) || 0;
  const slideType = typeof nextState?.slideType === 'string' ? nextState.slideType : '';
  const stepIdx = Math.max(0, Number(nextState?.stepIdx || 0) || 0);
  const stepParagraphs =
    typeof nextState?.stepParagraphs === 'boolean'
      ? nextState.stepParagraphs
      : !!s.state?.stepParagraphs;
  const updatedAt = Number(nextState?.updatedAt || 0) || Date.now();
  s.state = {
    slideId,
    slideIndex,
    slideType,
    stepIdx,
    stepParagraphs,
    updatedAt,
  };
  schedulePersist(s);
  broadcast(repoRoot, sessionId, 'state', s.state).catch(() => {});
  return s.state;
}

// Used by control module (sync surface). Kept here to avoid importing broadcast from main.
export function getSessionSync(sessionId) {
  return sessions.get(String(sessionId || '')) || null;
}

export function touchSessionSync(s) {
  if (!s) return;
  s.lastActivityAt = Date.now();
  schedulePersist(s);
}
