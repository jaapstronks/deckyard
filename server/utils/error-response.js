/**
 * Shape the body for the server's top-level error handler.
 *
 * The outer catch sees both intentional HTTP errors we threw (which set a
 * `statusCode` and carry a safe, human-authored message like "Request body too
 * large") and unexpected runtime errors (no `statusCode`, default 500). The
 * latter's `err.message` can leak filesystem paths or SQL fragments, so it must
 * never be echoed to the client — only errors we deliberately raised with an
 * explicit sub-500 status get their message surfaced.
 *
 * @param {number} status - Resolved HTTP status.
 * @param {*} err - The caught error.
 * @returns {{ error: string, details?: string }}
 */
export function buildTopLevelErrorBody(status, err) {
  const hasExplicitStatus = Number.isInteger(Number(err?.statusCode));
  if (status < 500 && hasExplicitStatus) {
    return {
      error: 'Request error',
      details: String(err?.message || 'Bad request'),
    };
  }
  return { error: status >= 500 ? 'Server error' : 'Request error' };
}
