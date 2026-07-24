/**
 * Minimal REST client for the running Deckyard dev server, used by capture
 * recipes to seed deterministic state before a screenshot.
 *
 * The dev server must be running with AUTH_DEV_BYPASS=true (see capture/README.md).
 * All requests are same-origin against BASE; the dev-bypass session means no
 * auth headers are needed.
 */

/**
 * @typedef {object} ApiClient
 * @property {(pathname: string) => Promise<any>} get
 * @property {(pathname: string, body?: unknown) => Promise<any>} post
 * @property {(pathname: string, body?: unknown) => Promise<any>} put
 * @property {(pathname: string) => Promise<any>} del
 * @property {string} base
 */

/**
 * Build a small fetch-based client bound to a base URL.
 * @param {string} base e.g. "http://localhost:4177"
 * @returns {ApiClient}
 */
export function createApi(base) {
  async function request(method, pathname, body, extraHeaders) {
    const headers = { ...extraHeaders };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${pathname} → ${res.status} ${text}`.trim());
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    base,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b, h) => request('PUT', p, b, h),
    del: (p) => request('DELETE', p),
  };
}

/**
 * Verify the dev server is reachable and answering the API. Throws a clear,
 * actionable error otherwise so the runner can fail fast instead of Puppeteer
 * timing out on a blank page.
 * @param {string} base
 */
export async function assertServerUp(base) {
  let list;
  try {
    list = await fetch(`${base}/api/presentations`, {
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    throw new Error(
      `Dev server not reachable at ${base}. Start it first:\n` +
        `  AUTH_DEV_BYPASS=true npm run start\n` +
        `(original error: ${e.message})`
    );
  }
  if (list.status === 401 || list.status === 403) {
    throw new Error(
      `Dev server at ${base} is up but not auto-logging-in. Run it with ` +
        `AUTH_DEV_BYPASS=true (dev only) so capture recipes can seed state.`
    );
  }
  if (!list.ok) {
    throw new Error(
      `Dev server at ${base} answered ${list.status} for /api/presentations.`
    );
  }
}

/**
 * Delete every presentation whose title starts with the given prefix. Recipes
 * seed decks under a reserved title prefix so re-runs stay idempotent without
 * touching a user's real decks.
 * @param {ApiClient} api
 * @param {string} prefix
 * @returns {Promise<number>} number removed
 */
export async function deleteDecksByPrefix(api, prefix) {
  let list;
  try {
    list = await api.get('/api/presentations');
  } catch {
    return 0;
  }
  const items = Array.isArray(list)
    ? list
    : list?.items || list?.presentations || [];
  const doomed = items.filter((p) =>
    String(p?.title || '').startsWith(prefix)
  );
  let removed = 0;
  for (const p of doomed) {
    try {
      await api.del(`/api/presentations/${p.id}`);
      removed += 1;
    } catch {
      // best-effort cleanup; ignore
    }
  }
  return removed;
}

/**
 * Create a presentation and overwrite its slides, returning the deck id.
 * Mirrors the create-then-PUT flow used by scripts/seed-bg-contrast-demo.js.
 * @param {ApiClient} api
 * @param {{title: string, theme?: string, slides?: unknown[]}} spec
 * @returns {Promise<string>} deck id
 */
export async function seedDeck(api, { title, theme = 'deckyard', slides = [] }) {
  const created = await api.post('/api/presentations', { title, theme });
  const id = created?.id || created?.presentation?.id;
  if (!id) throw new Error(`No id returned creating deck "${title}"`);
  const full = await api.get(`/api/presentations/${id}`);
  full.theme = theme;
  if (slides.length) full.slides = slides;
  // The PUT is optimistic-locked: send the current revision as If-Match. We send
  // no slide-merge headers (x-modified-slides / x-slide-base-fingerprints), so
  // the server takes the legacy full-replace path — exactly what we want for a
  // freshly created deck we're overwriting wholesale.
  await api.put(`/api/presentations/${id}`, full, {
    'If-Match': String(full.revision ?? 0),
  });
  return id;
}
