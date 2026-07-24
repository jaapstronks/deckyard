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
  const body = opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof Blob)
    ? JSON.stringify(opts.body)
    : opts.body;

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
        throw err;
      }
    }
    const body = await res.text();
    const err = new Error(
      (body && body.trim()) || `Request failed (${res.status})`
    );
    err.statusCode = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await res.json();
  return await res.text();
}
