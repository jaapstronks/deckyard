import { guardSseConnection } from './sse-limiter.js';

/**
 * Default interval for the per-connection comment heartbeat. 15s keeps
 * proxies and load balancers from timing out an idle stream while staying
 * far under any realistic idle-timeout budget.
 */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * Open a Server-Sent Events stream — the one way a handler turns a response
 * into an event stream. Writes the canonical header set, flushes it, starts
 * the per-connection heartbeat, applies the public-stream connection guard,
 * and wires cleanup to the request lifecycle.
 *
 * The header set, each with its reason:
 * - `Content-Type: text/event-stream` — without `charset`: SSE is UTF-8 by
 *   spec, the parameter is noise and breeds second spellings.
 * - `Cache-Control: no-cache` — the SSE-reference value (`no-store` said the
 *   same thing in a second spelling). Pass `cacheControl` to extend it
 *   (e.g. `'no-cache, no-transform'`).
 * - `Connection: keep-alive` and `X-Accel-Buffering: no` — every stream,
 *   always: a buffered SSE stream (nginx) is a broken SSE stream.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Object} [opts]
 * @param {boolean} [opts.guard=true] - Reserve a slot via the SSE connection
 *   limiter and 429 when over a cap. Opt out only for authenticated streams
 *   with their own lifecycle bounds (document why at the call site).
 * @param {number} [opts.heartbeatMs=SSE_HEARTBEAT_MS] - Per-connection
 *   comment-heartbeat interval; 0 disables (document why at the call site).
 * @param {string} [opts.cacheControl='no-cache']
 * @param {Object} [opts.extraHeaders] - Extra headers (e.g. `Set-Cookie`).
 * @param {() => void} [opts.onClose] - Called once when the client
 *   disconnects (after the heartbeat is stopped). NOT called when the
 *   handler already closed the stream itself via `close()` — a handler that
 *   replaces a stream (MCP GET) has already reassigned its references, and a
 *   late disconnect of the old socket must not clean up the new stream's.
 * @returns {{ ok: true, close: () => void } | { ok: false }} `ok: false`
 *   means the guard already sent a 429 — the handler should return handled.
 */
export function openSseStream(
  req,
  res,
  {
    guard = true,
    heartbeatMs = SSE_HEARTBEAT_MS,
    cacheControl = 'no-cache',
    extraHeaders = {},
    onClose,
  } = {},
) {
  if (guard && !guardSseConnection(req, res)) return { ok: false };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': cacheControl,
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...extraHeaders,
  });
  // writeHead only queues the header block; force it onto the wire so the
  // client sees the stream open before the first event (visible as "SSE
  // does nothing" on quiet streams otherwise).
  res.flushHeaders?.();

  let heartbeatTimer = null;
  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(
      () => sseComment(res, 'heartbeat'),
      heartbeatMs,
    );
    heartbeatTimer.unref?.();
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };

  req.on?.('close', () => {
    // Capture before close() flips it: onClose only fires for a stream the
    // handler had not already closed, and at most once.
    const alreadyClosed = closed;
    close();
    if (!alreadyClosed) onClose?.();
  });

  return { ok: true, close };
}

export function sseWrite(res, { event, data } = {}) {
  if (!res?.writable || res.writableEnded) return;
  // Build complete message first, then write atomically to prevent
  // interleaving when multiple broadcasts fire concurrently.
  let message = '';
  if (event) message += `event: ${event}\n`;
  if (data != null) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    message += `data: ${payload}\n`;
  }
  message += '\n';
  res.write(message);
}

/**
 * Build an SSE frame string (event + JSON data) for broadcasting the same
 * message to many clients — build once, `res.write()` to each. Module-private:
 * the only fan-out that needs it is the client hub below, and a public
 * frame-builder is an invitation to hand-roll a second writer next to
 * `sseWrite`.
 * @param {string} event
 * @param {*} data JSON-serializable payload
 * @returns {string}
 */
function formatSSEMessage(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * The payload for an SSE `error` event: `{ message, ...extra }`.
 *
 * Deliberately NOT the HTTP error envelope. `ok:false` would duplicate the
 * routing the `event: error` line already carries, and `error` stays reserved
 * for the machine code it means on the HTTP side instead of being re-used for
 * prose — the exact habit `docs/reference/api-error-format.md` exists to
 * prevent. `message` also matches `status` events, which already use it for
 * human text.
 *
 * Should a client ever need to branch on the cause, pass
 * `{ error: '<snake_case_code>' }` as `extra`: additive, with the same meaning
 * as in the HTTP envelope, and never a rename of a field a client reads.
 *
 * Routes that build their own `sendEvent` closure can call this to get the
 * shape right; routes on `sseWrite` get it by construction.
 *
 * @param {string} message - human-readable text, safe to display
 * @param {Object} [extra] - endpoint-specific extras (e.g. `report`)
 * @returns {{message: string}}
 */
export function sseErrorPayload(message, extra = null) {
  return { message: String(message || 'Unknown error'), ...(extra || {}) };
}

/**
 * Emit an SSE `error` event with the canonical payload.
 * @param {import('node:http').ServerResponse} res
 * @param {string} message
 * @param {Object} [extra]
 */
export function sseError(res, message, extra = null) {
  sseWrite(res, { event: 'error', data: sseErrorPayload(message, extra) });
}

export function sseComment(res, comment) {
  if (!res?.writable || res.writableEnded) return;
  res.write(`: ${String(comment || '').replace(/\n/g, ' ')}\n\n`);
}

/**
 * A keyed SSE client hub — the `Map<key, Set<res>>` registry plus the global
 * heartbeat lifecycle that the real-time services (notifications, comments)
 * each hand-rolled identically. Create one per channel; the service re-exports
 * the returned methods under its own domain names and keeps its event-type
 * constants.
 *
 * The key is normalized once, at the boundary, by `normalizeKey`: it returns the
 * storage key, or a falsy value to reject the operation (the notification hub
 * rejects a blank email this way). add / remove / broadcast all funnel through
 * it, so a channel has exactly one spelling of its key.
 *
 * @param {object} [options]
 * @param {(rawKey: *) => *} [options.normalizeKey] - Map a caller-supplied key
 *   to its storage form; return falsy to reject. Defaults to identity.
 * @param {number} [options.heartbeatMs=30000] - Global heartbeat interval; 30s
 *   keeps connections alive through most proxies.
 * @returns {{
 *   addClient: (rawKey: *, res: object) => void,
 *   removeClient: (rawKey: *, res: object) => void,
 *   broadcast: (rawKey: *, eventType: string, data: object) => void,
 *   broadcastAll: (eventType: string, data: object) => number,
 *   startHeartbeat: () => void,
 *   stopHeartbeat: () => void,
 * }}
 */
export function createSseHub({
  normalizeKey = (k) => k,
  heartbeatMs = 30_000,
} = {}) {
  /** @type {Map<*, Set<object>>} key -> set of open response objects */
  const clients = new Map();

  function addClient(rawKey, res) {
    const key = normalizeKey(rawKey);
    if (!key) return;
    let set = clients.get(key);
    if (!set) {
      set = new Set();
      clients.set(key, set);
    }
    set.add(res);
  }

  function removeClient(rawKey, res) {
    const key = normalizeKey(rawKey);
    if (!key) return;
    const set = clients.get(key);
    if (set) {
      set.delete(res);
      if (set.size === 0) clients.delete(key);
    }
  }

  /** Broadcast one event to every client under a single key. */
  function broadcast(rawKey, eventType, data) {
    const key = normalizeKey(rawKey);
    if (!key) return;
    const set = clients.get(key);
    if (!set || set.size === 0) return;
    const message = formatSSEMessage(eventType, data);
    for (const res of set) {
      try {
        res.write(message);
      } catch {
        // Client disconnected, will be cleaned up on 'close' event
      }
    }
  }

  /**
   * Broadcast one event to every client across every key (server-wide
   * announcements like maintenance mode).
   * @returns {number} Number of client connections written to.
   */
  function broadcastAll(eventType, data) {
    const message = formatSSEMessage(eventType, data);
    let sent = 0;
    for (const set of clients.values()) {
      for (const res of set) {
        try {
          res.write(message);
          sent += 1;
        } catch {
          // Client disconnected, will be cleaned up on 'close' event
        }
      }
    }
    return sent;
  }

  function sendAllHeartbeats() {
    for (const set of clients.values()) {
      for (const res of set) {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          // Ignore, will be cleaned up
        }
      }
    }
  }

  let heartbeatIntervalId = null;
  /** Start the global heartbeat (idempotent). */
  function startHeartbeat() {
    if (heartbeatIntervalId) return; // Already running
    heartbeatIntervalId = setInterval(sendAllHeartbeats, heartbeatMs);
    heartbeatIntervalId.unref?.(); // Don't keep process alive just for this
  }
  /** Stop the global heartbeat. */
  function stopHeartbeat() {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
  }

  return {
    addClient,
    removeClient,
    broadcast,
    broadcastAll,
    startHeartbeat,
    stopHeartbeat,
  };
}
