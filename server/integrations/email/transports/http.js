/** Fixed-endpoint API request. Never expose provider bodies or error messages. */
export async function postMail(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      ...options,
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
    });
    // We need only the status; do not read unbounded or sensitive error bodies.
    await response.body?.cancel();
    return response.ok
      ? { ok: true, status: response.status }
      : {
          ok: false,
          reason: 'upstream',
          status: response.status,
          error: `Mail provider returned HTTP ${response.status}`,
        };
  } catch {
    return {
      ok: false,
      reason: 'upstream',
      error: 'Mail provider connection failed or timed out',
    };
  } finally {
    clearTimeout(timeout);
  }
}
