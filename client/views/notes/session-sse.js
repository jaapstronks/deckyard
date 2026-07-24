import { withBackoff } from '../../lib/net/reconnect.js';

export function createNotesSessionSse({
  sessionId,
  onState,
  onControlEnabled,
  onDeckUpdated,
  onStatus,
} = {}) {
  let es = null;

  const connector = withBackoff(
    ({ onOpen, onError }) => {
      es = new EventSource(`/api/present-sessions/${sessionId}/events`);
      es.addEventListener('open', () => onOpen?.());
      es.addEventListener('error', () => onError?.());
      es.addEventListener('state', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          onState?.(data);
        } catch {
          // ignore
        }
      });
      es.addEventListener('controlEnabled', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          onControlEnabled?.(data);
        } catch {
          // ignore
        }
      });
      es.addEventListener('deckUpdated', () => onDeckUpdated?.());
      es.addEventListener('close', () => onError?.());
      return () => {
        try {
          es?.close?.();
        } catch {}
        es = null;
      };
    },
    { onStatus }
  );

  return {
    start: () => connector.start(),
    stop: () => connector.stop(),
  };
}
