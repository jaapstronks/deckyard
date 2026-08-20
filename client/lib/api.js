/**
 * The one client network layer (A7.16 cluster 2).
 *
 * Every request to our own `/api/*` surface goes through `api()`; raw `fetch(`
 * outside this module is lint-gated (`eslint.config.js`, no-restricted-syntax)
 * and allowed only for the documented exceptions — streaming-body readers
 * (SSE), binary/blob downloads, presigned uploads to external storage, and
 * static-asset JSON — each carrying an inline disable with its reason.
 *
 * Error handling has one canonical form. `api()` rejects with an `Error`
 * whose fields carry the whole canonical envelope
 * (`{ ok:false, error:'<code>', message:'<human>', details }`):
 *
 *   err.message    - human display text (errorText of the body, never empty)
 *   err.statusCode - HTTP status, for branching (401-redirects, 429 copy, ...)
 *   err.code       - stable machine code (`body.error`), for branching
 *   err.details    - structured extra detail, when the route sent any
 *   err.body       - the full parsed error body, for the rare caller that
 *                    reads route-specific fields (e.g. the share viewer's
 *                    `presentationTitle` on a revoked link)
 *
 * Callers show failures as `catch (e) { toast.error(e, opts) }` — toast
 * coerces an Error to its message (client/lib/dom/toast.js). There is
 * deliberately no `apiWithToast`/`withErrorToast` wrapper: transport and
 * presentation stay separate, and most catch blocks also reset local state,
 * so a wrapper would only add a second control-flow vocabulary next to the
 * try/catch they need anyway.
 */

/**
 * Extract human-readable display text from a parsed JSON error body, tolerating
 * both the canonical envelope (`{ ok:false, error:'<code>', message:'<human>' }`)
 * and legacy prose-in-`error` bodies. Prefers `message`, then `details`, then a
 * non-empty `error` string, finally the caller's `fallback`.
 *
 * Use this instead of reading `body.error` directly for display: once a route
 * moves to the canonical envelope, `error` becomes a machine code and only
 * `message` carries the human text. Code-branching (`body.error === 'x'`) should
 * still read `error` directly.
 *
 * @param {*} obj - parsed JSON body (or any value).
 * @param {string} [fallback] - text to use when nothing usable is present.
 * @returns {string}
 */
export function errorText(obj, fallback = '') {
  if (obj && typeof obj === 'object') {
    const human =
      (typeof obj.message === 'string' && obj.message.trim() && obj.message) ||
      (typeof obj.details === 'string' && obj.details.trim() && obj.details) ||
      (typeof obj.error === 'string' && obj.error.trim() && obj.error) ||
      null;
    if (human) return human;
  }
  return fallback;
}

export async function api(path, opts = {}) {
  // Auto-stringify body if it's an object (not FormData, Blob, etc.)
  const body =
    opts.body &&
    typeof opts.body === 'object' &&
    !(opts.body instanceof FormData) &&
    !(opts.body instanceof Blob)
      ? JSON.stringify(opts.body)
      : opts.body;

  // The one sanctioned fetch call: this module IS the network layer.
  // eslint-disable-next-line no-restricted-syntax
  const res = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body,
  });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      let obj = null;
      try {
        obj = await res.json();
      } catch {
        obj = null;
      }
      if (obj && typeof obj === 'object') {
        // Canonical envelope: { ok:false, error:'<machine_code>', message:'<human>' }.
        // `error` is a stable code to branch on (err.code); `message` is display
        // text. `errorText` falls back to `error`/`details` for legacy bodies.
        const code = typeof obj.error === 'string' ? obj.error : null;
        const err = new Error(errorText(obj, `Request failed (${res.status})`));
        err.statusCode = res.status;
        err.code = code;
        err.details = obj.details || null;
        err.body = obj;
        throw err;
      }
    }
    const body = await res.text();
    const err = new Error(
      (body && body.trim()) || `Request failed (${res.status})`,
    );
    err.statusCode = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await res.json();
  return await res.text();
}
