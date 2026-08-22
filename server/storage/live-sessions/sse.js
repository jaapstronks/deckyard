import { sseWrite } from '../../utils/sse.js';
import { toStorageContext } from '../scope.js';
import { schedulePersist } from './db.js';
import { sessions } from './state.js';
import { fireAndForget } from '../../utils/fire-and-forget.js';
import {
  touchLiveSession,
  findMostRecentSessionForPresentation,
} from './sessions.js';

/**
 * Attach one SSE client to a session's stream. Capability-based: the session
 * id (or follow code) is the authorization, so an audience scope may attach
 * cross-organization.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<(() => void)|null>} The detach handle, or null when there
 *   is no such session. Attaching a socket is process-local wiring rather than
 *   a write, so this keeps the read shape (storage-layer.md § Failure
 *   signalling).
 */
export async function attachSessionSseClient(scope, sessionId, res) {
  toStorageContext(
    scope,
    'attachSessionSseClient',
    {},
    { allowCrossOrganization: true },
  );
  const touched = await touchLiveSession(scope, sessionId);
  if (!touched.ok) return null;
  const s = touched.session;

  s.clients.add(res);

  // Initial snapshot
  sseWrite(res, { event: 'state', data: s.state });
  sseWrite(res, {
    event: 'controlEnabled',
    data: { controlEnabled: !!s.controlEnabled, updatedAt: Date.now() },
  });

  // No heartbeat here: openSseStream() owns the per-connection heartbeat.
  const detach = () => {
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
 * @param {import('../scope.js').StorageScope} scope
 * @returns {Promise<boolean>} Whether a local session was found to broadcast to.
 */
export async function broadcast(scope, sessionId, event, data) {
  toStorageContext(scope, 'broadcast', {}, { allowCrossOrganization: true });
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

export async function notifyLiveSessionInteractionState(
  scope,
  sessionId,
  interactionState,
) {
  toStorageContext(
    scope,
    'notifyLiveSessionInteractionState',
    {},
    { allowCrossOrganization: true },
  );
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  return broadcast(scope, sid, 'interactionState', {
    ...(interactionState && typeof interactionState === 'object'
      ? interactionState
      : {}),
    updatedAt: Date.now(),
  });
}

export function notifyLiveSessionDeckUpdated(
  scope,
  sessionId,
  { presentationId = '', slideId = '', reason = 'deck_updated' } = {},
) {
  toStorageContext(
    scope,
    'notifyLiveSessionDeckUpdated',
    {},
    { allowCrossOrganization: true },
  );
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, reason: 'missing_session_id' };
  const payload = {
    presentationId: String(presentationId || '').trim(),
    slideId: String(slideId || '').trim(),
    reason: String(reason || 'deck_updated'),
    updatedAt: Date.now(),
  };
  fireAndForget(
    broadcast(scope, sid, 'deckUpdated', payload),
    'live-session deckUpdated broadcast',
  );
  return { ok: true };
}

/**
 * Notify the live session (if any) for a presentation that its deck changed.
 * Resolves the most recent session for the presentation and broadcasts
 * `deckUpdated` to its clients; a no-op when nothing is being presented.
 */
export async function notifyDeckUpdatedForPresentation(
  scope,
  presentationId,
  { slideId = '', reason = 'deck_updated' } = {},
) {
  toStorageContext(
    scope,
    'notifyDeckUpdatedForPresentation',
    {},
    { allowCrossOrganization: true },
  );
  const pid = String(presentationId || '').trim();
  if (!pid) return { ok: false, reason: 'missing_presentation_id' };
  const s = await findMostRecentSessionForPresentation(scope, pid);
  if (!s?.sessionId || !s.clients?.size)
    return { ok: false, reason: 'no_live_session' };
  return notifyLiveSessionDeckUpdated(scope, s.sessionId, {
    presentationId: pid,
    slideId,
    reason,
  });
}

export function broadcastBranch(
  scope,
  sessionId,
  { slideId = '', onClose = 'stay', onCloseTarget = '' } = {},
) {
  // Presenter action (fired on interaction close): the scope states its organization.
  toStorageContext(scope, 'broadcastBranch');
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, reason: 'missing_session_id' };
  const payload = {
    slideId: String(slideId || '').trim(),
    onClose: String(onClose || 'stay').trim(),
    onCloseTarget: String(onCloseTarget || '').trim(),
    updatedAt: Date.now(),
  };
  fireAndForget(
    broadcast(scope, sid, 'branch', payload),
    'live-session branch broadcast',
  );
  return { ok: true };
}

/**
 * Replace a session's live state and push it to every attached client.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {object} nextState
 * @returns {Promise<{ok: true, state: object}|{ok: false, reason: string}>}
 */
export async function updateLiveSessionState(scope, sessionId, nextState) {
  // Presenter action (state push): the scope states its organization.
  toStorageContext(scope, 'updateLiveSessionState');
  const touched = await touchLiveSession(scope, sessionId);
  if (!touched.ok) return { ok: false, reason: 'not_found' };
  const s = touched.session;
  const slideId =
    typeof nextState?.slideId === 'string' ? nextState.slideId : '';
  const slideIndex = Number(nextState?.slideIndex || 0) || 0;
  const slideType =
    typeof nextState?.slideType === 'string' ? nextState.slideType : '';
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
  fireAndForget(
    broadcast(scope, sessionId, 'state', s.state),
    'live-session state broadcast',
  );
  return { ok: true, state: s.state };
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
