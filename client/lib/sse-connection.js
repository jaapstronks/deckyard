/**
 * SSE (Server-Sent Events) connection utility with reconnection logic.
 */

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;

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
}) {
  let eventSource = null;
  let reconnectAttempts = 0;
  let reconnectTimeoutId = null;
  let connectionState = STATE.DISCONNECTED;

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
    if (connectionState !== STATE.FAILED && connectionState !== STATE.DISCONNECTED) {
      setState(STATE.DISCONNECTED);
      onDisconnected?.();
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  function scheduleReconnect() {
    if (connectionState === STATE.FAILED) {
      console.warn('SSE: Max reconnect attempts reached, not scheduling reconnect');
      return;
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      setState(STATE.FAILED);
      onError?.(new Error('Max reconnection attempts reached'));
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, etc. (max ~17 minutes)
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
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
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent reconnection
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