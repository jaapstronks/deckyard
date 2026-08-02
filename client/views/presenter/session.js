// Presenter session helpers (notes companion + optional remote control via SSE).
//
// The `controlEnabled` SSE event is deliberately not listened for here. The
// only writer is the checkbox in this same tab, so the event would be the
// presenter hearing their own click come back off the server. The notes
// companion does subscribe (`client/views/notes/session-sse.js`) — there it is
// a different tab, so it carries information.

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
  const created = await api('/api/present-sessions', {
    method: 'POST',
    body: JSON.stringify({ presentationId }),
  });
  const sessionId = created?.sessionId || null;
  let es = null;

  if (sessionId) {
    es = new EventSource(`/api/present-sessions/${sessionId}/events`);
    es.addEventListener('control', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        const action = String(data?.action || '');
        if (action === 'next') onNext?.();
        else if (action === 'prev') onPrev?.();
        else if (action === 'goto') onGoto?.(Number(data?.slideIndex));
      } catch {
        // ignore
      }
    });
    es.addEventListener('deckUpdated', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        onDeckUpdated?.(data);
      } catch {
        // ignore
      }
    });
    es.addEventListener('interactionState', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        onInteractionState?.(data);
      } catch (err) {
        console.error('[presenter] SSE interactionState parse error:', err.message, 'Raw:', ev.data?.slice?.(0, 200));
      }
    });
    es.addEventListener('branch', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        onBranch?.(data);
      } catch {
        // ignore
      }
    });
  }

  const close = () => {
    if (!es) return;
    try {
      es.close();
    } catch {}
    es = null;
  };

  return { sessionId, followCodes: created?.followCodes, close };
}
