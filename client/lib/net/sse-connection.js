/**
 * SSE (Server-Sent Events) connection utility with reconnection logic.
 *
 * This is the one canonical client SSE helper: every `new EventSource` in the
 * client lives here (the `no-raw-eventsource` gate pins that). Reconnect policy
 * is expressed through options rather than hand-rolled per view — the class of
 * bug this exists to kill is a reopen timer that outlives the view that owns it.
 */

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * Reconnect preset for long-lived streams (notifications, Q&A, notes/presenter
 * sessions): reconnect indefinitely, but cap the exponential delay so a wedged
 * server is retried on a sane cadence instead of every ~17 minutes. Spread it
 * into `createSSEConnection(...)` so the policy stays in one place.
 */
export const LONG_LIVED_STREAM = Object.freeze({
  maxReconnectAttempts: Infinity,
  maxDelayMs: 30_000,
});

// Connection states
const STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  FAILED: 'failed',
};

/**
 * Create an SSE connection with automatic reconnection.
 * @param {Object} options - Configuration options
 * @param {string} options.url - The SSE endpoint URL
 * @param {string[]} options.events - Event types to listen for
 * @param {Function} options.onEvent - Callback for events (event) => void
 * @param {Function} [options.onError] - Callback for errors (error) => void
 * @param {Function} [options.onConnected] - Callback when connection is established
 * @param {Function} [options.onDisconnected] - Callback when disconnected
 * @param {Function} [options.onStateChange] - Callback when state changes (state) => void
 * @param {number} [options.maxReconnectAttempts=10] - How many times to retry a
 *   dropped connection before giving up. `Infinity` retries forever; `0` never
 *   reconnects (a drop is terminal).
 * @param {number} [options.baseDelayMs=1000] - First backoff delay; doubles each attempt.
 * @param {number} [options.maxDelayMs=Infinity] - Ceiling for the doubling delay.
 * @returns {Object} Connection API with connect, disconnect, isConnected, getState
 */
export function createSSEConnection({
  url,
  events,
  onEvent,
  onError,
  onConnected,
  onDisconnected,
  onStateChange,
  maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = Infinity,
}) {
  let eventSource = null;
  let reconnectAttempts = 0;
  let reconnectTimeoutId = null;
  let connectionState = STATE.DISCONNECTED;
  // Set by stop(); cleared by connect(). Guards the window where a pending
  // onerror (or an in-flight reconnect timer) could reopen a stream whose view
  // has already torn down. connect() clears it so stop()/connect() cycles work
  // (Q&A toggles the stream on and off as its capability flips).
  let stopped = false;

  function setState(newState) {
    if (connectionState !== newState) {
      connectionState = newState;
      onStateChange?.(newState);
    }
  }

  /**
   * Handle incoming SSE events.
   */
  function handleEvent(event) {
    try {
      onEvent(event);
    } catch (err) {
      onError?.(err);
    }
  }

  /**
   * Connect to the SSE endpoint.
   */
  function connect() {
    if (eventSource) return; // Already connected or connecting
    stopped = false;
    if (connectionState === STATE.FAILED) {
      // Reset failed state to allow new connection attempts
      reconnectAttempts = 0;
    }

    setState(reconnectAttempts > 0 ? STATE.RECONNECTING : STATE.CONNECTING);

    try {
      eventSource = new EventSource(url, { withCredentials: true });

      // Listen for specific event types
      for (const eventType of events) {
        eventSource.addEventListener(eventType, handleEvent);
      }

      // Handle successful connection. Without this, the state never reaches
      // CONNECTED and reconnectAttempts never resets, so a handful of
      // transient drops over a long session would permanently FAIL the
      // connection.
      eventSource.onopen = () => {
        setState(STATE.CONNECTED);
        reconnectAttempts = 0;
        onConnected?.();
      };

      // Back-compat: some endpoints may emit an explicit `connected` event.
      eventSource.addEventListener('connected', (event) => {
        setState(STATE.CONNECTED);
        reconnectAttempts = 0;
        handleEvent(event);
      });

      eventSource.onerror = () => {
        // Connection lost, attempt to reconnect
        disconnect();
        scheduleReconnect();
      };
    } catch (err) {
      onError?.(err);
      scheduleReconnect();
    }
  }

  /**
   * Disconnect from the SSE endpoint.
   */
  function disconnect() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    if (
      connectionState !== STATE.FAILED &&
      connectionState !== STATE.DISCONNECTED
    ) {
      setState(STATE.DISCONNECTED);
      onDisconnected?.();
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  function scheduleReconnect() {
    if (stopped) return;
    if (connectionState === STATE.FAILED) {
      console.warn(
        'SSE: Max reconnect attempts reached, not scheduling reconnect',
      );
      return;
    }

    // A stream configured never to reconnect treats any drop as terminal, and
    // quietly — there is no failure to report, this is the intended end.
    if (maxReconnectAttempts <= 0) {
      setState(STATE.FAILED);
      return;
    }

    if (reconnectAttempts >= maxReconnectAttempts) {
      setState(STATE.FAILED);
      onError?.(new Error('Max reconnection attempts reached'));
      return;
    }

    // Exponential backoff (1s, 2s, 4s, …), capped at maxDelayMs.
    const delay = Math.min(
      maxDelayMs,
      baseDelayMs * Math.pow(2, reconnectAttempts),
    );
    reconnectAttempts++;

    setState(STATE.RECONNECTING);

    reconnectTimeoutId = setTimeout(() => {
      reconnectTimeoutId = null;
      connect();
    }, delay);
  }

  /**
   * Stop the connection and prevent any reconnection attempts.
   */
  function stop() {
    stopped = true; // Prevent any reconnection until connect() is called again
    reconnectAttempts = 0;
    disconnect();
    setState(STATE.DISCONNECTED);
  }

  /**
   * Check if currently connected.
   */
  function isConnected() {
    return connectionState === STATE.CONNECTED;
  }

  /**
   * Get current connection state.
   */
  function getState() {
    return connectionState;
  }

  return {
    connect,
    disconnect,
    stop,
    isConnected,
    getState,
    STATE, // Export states for external use
  };
}
