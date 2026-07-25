export function sseWrite(res, { event, data } = {}) {
  if (!res?.writable || res.writableEnded) return;
  // Build complete message first, then write atomically to prevent
  // interleaving when multiple broadcasts fire concurrently.
  let message = '';
  if (event) message += `event: ${event}\n`;
  if (data != null) {
    const payload =
      typeof data === 'string' ? data : JSON.stringify(data);
    message += `data: ${payload}\n`;
  }
  message += '\n';
  res.write(message);
}

/**
 * Build an SSE frame string (event + JSON data) for broadcasting the same
 * message to many clients — build once, `res.write()` to each.
 * @param {string} event
 * @param {*} data JSON-serializable payload
 * @returns {string}
 */
export function formatSSEMessage(event, data) {
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
  res.write(
    `: ${String(comment || '').replace(/\n/g, ' ')}\n\n`
  );
}
