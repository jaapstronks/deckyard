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
        const msg = (obj.error || obj.details) ?? null;
        const err = new Error(
          (typeof msg === 'string' && msg.trim()) ||
            `Request failed (${res.status})`
        );
        err.statusCode = res.status;
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
