/**
 * Server-Sent Events (SSE) Utilities
 *
 * Shared utilities for parsing SSE event streams.
 */

import { debugLog } from '../state/debug.js';

/**
 * Parse SSE events from a text chunk.
 *
 * SSE format:
 * event: eventName
 * data: {"json": "payload"}
 *
 * Events are separated by blank lines.
 *
 * @param {string} chunk - Raw text chunk from SSE stream
 * @returns {Array<{event: string, data: object}>} Parsed events
 */
function parseSSEChunk(chunk) {
  const events = [];
  const lines = chunk.split('\n');
  let currentEvent = null;
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentEvent && currentData) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(currentData) });
      } catch (err) {
        debugLog('[sse] Invalid event JSON', err);
      }
      currentEvent = null;
      currentData = '';
    }
  }
  return events;
}

/**
 * Process an SSE stream and call handlers for each event type.
 *
 * @param {ReadableStream} body - Response body stream
 * @param {Object} handlers - Event handlers keyed by event name
 * @param {Function} [handlers.onStatus] - Handler for 'status' events
 * @param {Function} [handlers.onMessages] - Handler for 'messages' events
 * @param {Function} [handlers.onComplete] - Handler for 'complete' events
 * @param {Function} [handlers.onError] - Handler for 'error' events
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Stops reading and dispatching on teardown.
 * @returns {Promise<void>}
 */
export async function processSSEStream(body, handlers = {}, { signal } = {}) {
  signal?.throwIfAborted();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const abort = () => {
    reader.cancel().catch((err) => debugLog('[sse] Cancelled reader', err));
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = parseSSEChunk(buffer);

      // Keep only the unparsed remainder
      const lastNewline = buffer.lastIndexOf('\n\n');
      if (lastNewline !== -1) {
        buffer = buffer.slice(lastNewline + 2);
      }

      for (const evt of events) {
        signal?.throwIfAborted();
        const handler =
          handlers[
            `on${evt.event.charAt(0).toUpperCase()}${evt.event.slice(1)}`
          ] || handlers[evt.event];
        if (handler) {
          await handler(evt.data);
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
