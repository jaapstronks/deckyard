/**
 * SSE connection for the follow view.
 * Uses the shared SSE connection utility for robust reconnection handling.
 */

import { createSSEConnection } from '../../lib/sse-connection.js';

/**
 * Create an SSE connection for the follow view.
 * @param {Object} options - Configuration options
 * @param {string} options.presentationId - The presentation ID
 * @param {Function} [options.getCopy] - Function to get localized copy
 * @param {HTMLElement} [options.statusEl] - Element to show connection status
 * @param {Function} [options.onStatusEvent] - Handler for 'status' events
 * @param {Function} [options.onStateEvent] - Handler for 'state' events
 * @param {Function} [options.onInteractionStateEvent] - Handler for 'interactionState' events
 * @param {Function} [options.onDeckUpdatedEvent] - Handler for 'deckUpdated' events (deck content changed mid-session)
 * @returns {Object} Connection API with connect, destroy methods
 */
export function createFollowSse({
  presentationId,
  getCopy,
  statusEl,
  onStatusEvent,
  onStateEvent,
  onInteractionStateEvent,
  onDeckUpdatedEvent,
} = {}) {
  /**
   * Parse event data safely.
   * @param {MessageEvent} event - SSE event
   * @returns {Object|null} Parsed data or null if invalid
   */
  function parseEventData(event) {
    try {
      return JSON.parse(event.data || '{}');
    } catch (err) {
      console.error('[follow] SSE parse error:', err.message, 'Raw:', event.data?.slice?.(0, 200));
      return null;
    }
  }

  let lastEventAt = 0;

  /**
   * Handle incoming SSE events.
   */
  function handleEvent(event) {
    lastEventAt = Date.now();
    const data = parseEventData(event);
    if (!data) return;

    switch (event.type) {
      case 'status':
        onStatusEvent?.(data);
        break;
      case 'state':
        onStateEvent?.(data);
        break;
      case 'interactionState':
        onInteractionStateEvent?.(data);
        break;
      case 'deckUpdated':
        onDeckUpdatedEvent?.(data);
        break;
      case 'close':
        connection.disconnect();
        break;
    }
  }

  const connection = createSSEConnection({
    url: `/api/follow/${encodeURIComponent(presentationId)}/events`,
    events: ['status', 'state', 'interactionState', 'deckUpdated', 'close'],
    onEvent: handleEvent,
    onStateChange: (state) => {
      const copy = getCopy?.();
      if (statusEl && copy?.connecting && state === connection.STATE.RECONNECTING) {
        statusEl.textContent = copy.connecting;
      }
    },
    onError: () => {
      const copy = getCopy?.();
      if (statusEl && copy?.connecting) {
        statusEl.textContent = copy.connecting;
      }
    },
  });

  return {
    connect: connection.connect,
    destroy: connection.stop,
    /**
     * True when the SSE stream is connected and has delivered an event
     * recently (the server pushes a `status` event every 2s, so a healthy
     * stream always passes). Used to skip the polling safety-net.
     * @returns {boolean}
     */
    isHealthy: () =>
      connection.isConnected() && Date.now() - lastEventAt < 8000,
  };
}