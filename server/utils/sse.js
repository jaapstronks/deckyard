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

export function sseComment(res, comment) {
  if (!res?.writable || res.writableEnded) return;
  res.write(
    `: ${String(comment || '').replace(/\n/g, ' ')}\n\n`
  );
}
