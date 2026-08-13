import { attachQuestionsSseClient } from '../../../storage/questions.js';
import { sseWrite, openSseStream } from '../../../utils/sse.js';
import { ensureQaDeviceCookie, followAudienceScope } from './helpers.js';
import { subscribeFollowStatus } from './status-ticker.js';

export async function handleFollowQuestionsEvents(
  { repoRoot, req, res },
  presentationId
) {
  if (req.method !== 'GET') return false;

  const dev = ensureQaDeviceCookie(req);
  // openSseStream applies the connection guard (429 before stream headers).
  const stream = openSseStream(req, res, {
    extraHeaders: dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {},
  });
  if (!stream.ok) return true;

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

    // If Q&A is disabled at the presentation level, never attach to the questions session.
    if (shared.capabilities?.canUseQa === false) {
      detachSession();
      return;
    }

    const state = shared.state;
    if (state.status === 'live' && state.sessionId) {
      if (state.sessionId !== currentSessionId) {
        detachSession();
        currentSessionId = state.sessionId;
        detach = await attachQuestionsSseClient(followAudienceScope(repoRoot), currentSessionId, res);
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
