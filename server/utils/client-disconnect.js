/**
 * The one way a handler learns that its client went away: an `AbortSignal`
 * derived from the response. Long work a request starts (a provider fetch, an
 * upload loop, a write) takes this signal, so a cancelled request stops that
 * work instead of finishing it for nobody.
 *
 * `openSseStream` hands out the same signal for event streams; a plain JSON
 * route (convert, Notion import) calls this directly. One source, one
 * contract, whatever carries the answer back.
 *
 * Disconnect is read from the response, not the request. A request whose
 * body the handler already consumed is done: `req` emits `close` right then
 * and never again, so a POST handler listening on `req` would miss the client
 * leaving. `res` emits `close` once, when the connection ends, and
 * `writableFinished` says whether the handler got there first — an answered
 * request is not a cancelled one.
 *
 * @param {import('node:http').ServerResponse} res
 * @returns {AbortSignal} aborts when the client leaves before the handler
 *   ended the response.
 */
export function clientDisconnectSignal(res) {
  const disconnect = new AbortController();
  // A client that left before we started listening: its `close` is gone.
  if (res.destroyed && !res.writableFinished) {
    disconnect.abort();
    return disconnect.signal;
  }
  res.on?.('close', () => {
    if (!res.writableFinished) disconnect.abort();
  });
  return disconnect.signal;
}
