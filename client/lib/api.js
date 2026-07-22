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
        // text. Fall back to `error`/`details` for any legacy prose-in-error body.
        const code = typeof obj.error === 'string' ? obj.error : null;
        const human =
          (typeof obj.message === 'string' && obj.message.trim() && obj.message) ||
          (typeof obj.details === 'string' && obj.details.trim() && obj.details) ||
          (typeof obj.error === 'string' && obj.error.trim() && obj.error) ||
          null;
        const err = new Error(human || `Request failed (${res.status})`);
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
