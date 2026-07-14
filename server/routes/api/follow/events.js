import { attachSessionSseClient } from '../../../storage/present-sessions.js';
import { sseWrite } from '../../../utils/sse.js';
import { writeSseHeaders } from './helpers.js';
import { subscribeFollowStatus } from './status-ticker.js';

export async function handleFollowEvents({ repoRoot, req, res }, presentationId) {
  if (req.method !== 'GET') return false;

  writeSseHeaders(res);

  let detach = null;
  let currentSessionId = '';
  let stopped = false;

  const detachSession = () => {
    if (typeof detach === 'function') {
      try {
        detach();
      } catch {}
    }
    detach = null;
    currentSessionId = '';
  };

  // Called once immediately, then on every shared per-presentation tick
  // (state + presentation are computed once for all followers).
  const onStatus = async (shared) => {
    if (stopped) return;
    sseWrite(res, { event: 'status', data: shared.statusJson });

    const state = shared.state;
    if (state.status === 'live' && state.sessionId) {
      if (state.sessionId !== currentSessionId) {
        detachSession();
        currentSessionId = state.sessionId;
        // This will also emit an initial `state` event.
        detach = await attachSessionSseClient(repoRoot, state.sessionId, res);
      }
    } else {
      detachSession();
    }
  };

  const unsubscribe = subscribeFollowStatus(repoRoot, presentationId, onStatus);

  const cleanup = () => {
    stopped = true;
    try {
      unsubscribe();
    } catch {}
    detachSession();
  };

  res.on?.('close', cleanup);
  res.on?.('finish', cleanup);

  return true;
}
