/**
 * Minimal REST client for the running Deckyard dev server, used by capture
 * recipes to seed deterministic state before a screenshot.
 *
 * The dev server must be running with AUTH_DEV_BYPASS=true (see capture/README.md).
 * All requests are same-origin against BASE; the dev-bypass session means no
 * auth headers are needed.
 */

import { DEFAULT_THEME_ID } from '../../shared/constants/themes.js';

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
        `(original error: ${e.message})`,
    );
  }
  if (list.status === 401 || list.status === 403) {
    throw new Error(
      `Dev server at ${base} is up but not auto-logging-in. Run it with ` +
        `AUTH_DEV_BYPASS=true (dev only) so capture recipes can seed state.`,
    );
  }
  if (!list.ok) {
    throw new Error(
      `Dev server at ${base} answered ${list.status} for /api/presentations.`,
    );
  }
}

/**
 * Set the signed-in user's UI language, which is what the app chrome follows.
 *
 * Call this *before* navigating: `client/app.js` reads `mySettings.uiLocale`
 * during boot and overrides whatever `?lang=`/localStorage suggested, so
 * setting it after the page has loaded changes nothing for this shot.
 *
 * It is also **sticky** — an account setting, not a per-request one — so any
 * recipe whose shot contains UI text should set it rather than inherit
 * whatever the previous recipe in a `--all` run left behind.
 *
 * @param {ApiClient} api
 * @param {string} locale A UI locale id from `client/i18n/manifest.json`
 *   (`'en'`, `'nl'`, …). Note this is *not* a presentation language: English
 *   is `en` here and `en-GB` in `?lang=`.
 * @returns {Promise<void>}
 */
export async function setUiLocale(api, locale) {
  await api.put('/api/settings/me', { uiLocale: locale });
}

/**
 * Display name every capture run puts on the account it signs in as.
 *
 * A fictional person, deliberately not one of the commenters in
 * `recipes/_marketing-deck.js`: the deck's owner is not someone leaving
 * feedback on it.
 */
export const CAPTURE_ACCOUNT_NAME = 'Milan de Groot';

/**
 * Set the signed-in user's display name.
 *
 * The editor chrome names whoever owns the deck — the author chip beside the
 * title, the avatar in the corner, the initials on a presence dot — and falls
 * back to the local part of the address when no profile name is stored. On a
 * capture run that address is the dev bypass's `dev@local.test`, so an unset name
 * puts "Dev" in the frame of every shot that shows the app around a deck.
 *
 * This is the account's own profile field, the same one the settings screen
 * writes, so the shot shows a demo account with a name rather than a debug
 * identity dressed up afterwards.
 *
 * @param {ApiClient} api
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function setDisplayName(api, name) {
  await api.put('/api/settings/me', { profile: { name } });
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
  const doomed = items.filter((p) => String(p?.title || '').startsWith(prefix));
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
 * Issue a share link for a deck.
 *
 * The rules a link carries (password, expiry, permission, registration mode)
 * are what the `share-link-rules` shot is about, and they are set at creation:
 * a link created here is a real record the dialog then lists, rather than a
 * row the recipe drew.
 *
 * @param {ApiClient} api
 * @param {string} deckId
 * @param {object} spec
 * @param {'view'|'comment'} spec.permission
 * @param {string} [spec.label] Shown as the link's name in the list.
 * @param {string} [spec.password] Sets `hasPassword`, which draws the lock.
 * @param {string} [spec.expiresAt] ISO timestamp.
 * @param {'invite_only'|'open'} [spec.registrationMode]
 * @returns {Promise<any>} the created share link
 */
export async function createShareLink(
  api,
  deckId,
  { permission = 'view', label, password, expiresAt, registrationMode } = {},
) {
  const created = await api.post(`/api/presentations/${deckId}/share-links`, {
    permission,
    ...(label ? { label } : {}),
    ...(password ? { password } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(registrationMode ? { registrationMode } : {}),
  });
  const link = created?.shareLink || created;
  if (!link?.id) {
    throw new Error(`No share link returned for deck ${deckId}`);
  }
  return link;
}

/**
 * Create a presentation and overwrite its slides, returning the deck id.
 * Mirrors the create-then-PUT flow used by scripts/seed-bg-contrast-demo.js.
 * @param {ApiClient} api
 * @param {{title: string, theme?: string, slides?: unknown[]}} spec
 * @returns {Promise<string>} deck id
 */
export async function seedDeck(
  api,
  { title, theme = DEFAULT_THEME_ID, slides = [] },
) {
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
