import { createSSEConnection, LONG_LIVED_STREAM } from '../../lib/net/sse-connection.js';

export function createNotesSessionSse({
  sessionId,
  onState,
  onControlEnabled,
  onDeckUpdated,
  onStatus,
} = {}) {
  const connection = createSSEConnection({
    url: `/api/live-sessions/${sessionId}/events`,
    events: ['state', 'controlEnabled', 'deckUpdated'],
    onEvent: (ev) => {
      switch (ev.type) {
        case 'state': {
          try {
            onState?.(JSON.parse(ev.data || '{}'));
          } catch {
            // ignore
          }
          break;
        }
        case 'controlEnabled': {
          try {
            onControlEnabled?.(JSON.parse(ev.data || '{}'));
          } catch {
            // ignore
          }
          break;
        }
        case 'deckUpdated':
          onDeckUpdated?.();
          break;
      }
    },
    // The consumer only cares that the stream dropped (to show a reconnecting
    // hint); RECONNECTING is that signal. The server ends the response after a
    // `close` event, so the helper's native onerror path reopens the stream.
    onStateChange: (state) => {
      if (state === connection.STATE.RECONNECTING) onStatus?.({ kind: 'error' });
    },
    ...LONG_LIVED_STREAM,
  });

  return {
    start: () => connection.connect(),
    stop: () => connection.stop(),
  };
}
