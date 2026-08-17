// Presenter session helpers (notes companion + optional remote control via SSE).
//
// The `controlEnabled` SSE event is deliberately not listened for here. The
// only writer is the checkbox in this same tab, so the event would be the
// presenter hearing their own click come back off the server. The notes
// companion does subscribe (`client/views/notes/session-sse.js`) — there it is
// a different tab, so it carries information.

import { createSSEConnection, LONG_LIVED_STREAM } from '../../lib/net/sse-connection.js';

export async function startPresenterSession({
  api,
  presentationId,
  onNext,
  onPrev,
  onGoto,
  onDeckUpdated,
  onInteractionState,
  onBranch,
} = {}) {
  const created = await api('/api/live-sessions', {
    method: 'POST',
    body: JSON.stringify({ presentationId }),
  });
  const sessionId = created?.sessionId || null;
  let connection = null;

  if (sessionId) {
    connection = createSSEConnection({
      url: `/api/live-sessions/${sessionId}/events`,
      events: ['control', 'deckUpdated', 'interactionState', 'branch'],
      onEvent: (ev) => {
        switch (ev.type) {
          case 'control': {
            try {
              const data = JSON.parse(ev.data || '{}');
              const action = String(data?.action || '');
              if (action === 'next') onNext?.();
              else if (action === 'prev') onPrev?.();
              else if (action === 'goto') onGoto?.(Number(data?.slideIndex));
            } catch {
              // ignore
            }
            break;
          }
          case 'deckUpdated': {
            try {
              const data = JSON.parse(ev.data || '{}');
              onDeckUpdated?.(data);
            } catch {
              // ignore
            }
            break;
          }
          case 'interactionState': {
            try {
              const data = JSON.parse(ev.data || '{}');
              onInteractionState?.(data);
            } catch (err) {
              console.error('[presenter] SSE interactionState parse error:', err.message, 'Raw:', ev.data?.slice?.(0, 200));
            }
            break;
          }
          case 'branch': {
            try {
              const data = JSON.parse(ev.data || '{}');
              onBranch?.(data);
            } catch {
              // ignore
            }
            break;
          }
        }
      },
      ...LONG_LIVED_STREAM,
    });
    connection.connect();
  }

  const close = () => {
    connection?.stop();
    connection = null;
  };

  return { sessionId, followCodes: created?.followCodes, close };
}
