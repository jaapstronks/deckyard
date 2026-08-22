/**
 * A database theme reaches the three anonymous surfaces, or the deck is blank.
 *
 * A **custom** (database) theme is a row, not a file: the client resolves it
 * through `GET /api/themes/custom/:id/config`, which sits behind the login
 * gate. Every surface that exists for people without an account therefore got
 * a 401 there, swallowed it, and rendered the deck on a neutral fallback
 * theme — silently unbranded, which is the whole point of a theme.
 *
 * The fix is the one `POST /api/share/:token/verify` already made for the deck
 * itself: the theme rides on the payload the capability authorizes, rather
 * than through a second, id-addressed route opened to the world. A UUID being
 * hard to guess is not an authorization story, and re-opening one is exactly
 * the pattern #926 removed. The three payloads:
 *
 *   - `POST /api/share/:token/verify`          — share-link viewer
 *   - `GET  /api/follow/:id/presentation`      — follow-along audience
 *   - `GET  /api/live-sessions/:id/deck`       — notes companion
 *
 * Pinned below: a custom-theme deck carries its theme on all three, a built-in
 * deck carries `null` (those load as static files, client-side, as before),
 * and what travels is `buildThemeConfig`'s render projection — no ownership,
 * organization or authorship stamp leaves with it.
 *
 * Route-level tests in the house shape (see `tests/live-session-notes-write.test.js`):
 * the exported handlers are called directly with a req/res double over
 * `tests/helpers/fake-db.js`.
 *
 * Run with: node --test tests/anon-custom-theme-payload.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const REPO_ROOT = '/tmp/deckyard-anon-theme-test';
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { createTheme } = await import('../server/storage/themes.js');
const { createShareLink } =
  await import('../server/storage/share-links/index.js');
const { createLiveSession, updateLiveSessionState } =
  await import('../server/storage/live-sessions/index.js');
const { handleSharePublicEndpoints } =
  await import('../server/routes/api/share-links/public.js');
const { handleFollowPresentation } =
  await import('../server/routes/api/follow/presentation.js');
const { handleLiveSessionsPublic } =
  await import('../server/routes/api/live-session-audience.js');
const { clearCustomThemeCache } = await import('../server/utils/themes.js');
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test.beforeEach(() => {
  resetRateLimitBuckets();
  // The theme loader memoizes per UUID for the life of the process; each case
  // mints its own theme row, so a stale entry would be a lie either way.
  clearCustomThemeCache();
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeReq({ method = 'GET', headers = {}, body = null } = {}) {
  const buf = Buffer.from(body == null ? '' : JSON.stringify(body), 'utf8');
  return {
    method,
    headers,
    socket: {},
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

const jsonBody = (res) => JSON.parse(String(res.body || '{}'));

/** Presenter scope (states its organization — a state push is not anonymous). */
const presenterScope = { repoRoot: REPO_ROOT, organizationId: ORG };

let themeSeq = 0;

/** A database theme with a recognizable primary colour. */
async function seedCustomTheme(primary = '#ff0055') {
  themeSeq += 1;
  const created = await createTheme(testScope(null, { actorEmail: OWNER }), {
    label: `Brand ${themeSeq}`,
    slug: `brand-${themeSeq}`,
    colors: {
      primary,
      background: '#101014',
      textLight: '#ffffff',
      textDark: '#101014',
    },
  });
  assert.equal(created.ok, true, 'the theme row is created');
  return created.theme;
}

/** A deck on the given theme id. */
async function seedDeck(theme) {
  return createPresentation(testScope(), {
    title: 'Branded deck',
    ownerEmail: OWNER,
    theme,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
}

/** A live session pushed onto slide 0, so follow state reports `live`. */
async function goLive(pres) {
  const session = await createLiveSession(
    { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: null },
    { presentationId: pres.id },
  );
  await updateLiveSessionState(presenterScope, session.sessionId, {
    slideId: pres.slides[0].id,
    slideIndex: 0,
    slideType: pres.slides[0].type,
    updatedAt: Date.now(),
  });
  return session.sessionId;
}

// ---------------------------------------------------------------------------
// Surface 1 — the share-link viewer
// ---------------------------------------------------------------------------

/** `POST /api/share/:token/verify` through the public dispatcher. */
async function verifyShare(token, body = {}) {
  const res = fakeRes();
  const handled = await handleSharePublicEndpoints({
    repoRoot: REPO_ROOT,
    req: fakeReq({ method: 'POST', body }),
    res,
    url: new URL(`/api/share/${token}/verify`, 'http://localhost'),
  });
  return { res, handled, body: jsonBody(res) };
}

async function seedShareLink(theme) {
  const pres = await seedDeck(theme);
  const link = await createShareLink(testScope(), pres.id, {
    permission: 'view',
  });
  assert.equal(link.ok, true);
  return { pres, token: link.shareLink.token };
}

test('verify hands the anonymous viewer the deck theme, not a 401 it cannot see', async () => {
  const theme = await seedCustomTheme('#ff0055');
  const { token } = await seedShareLink(theme.id);

  const { res, body } = await verifyShare(token);
  assert.equal(res.statusCode, 200);

  const config = body.presentation.themeConfig;
  assert.equal(body.presentation.theme, theme.id, 'the id still travels');
  assert.equal(
    config?._customThemeId,
    theme.id,
    'and so does the config it addresses',
  );
  assert.equal(config.label, theme.label);
  assert.equal(
    config.cssVars['--t-color-accent'],
    '#ff0055',
    "the theme's own colour reaches the viewer",
  );
});

test('a built-in theme sends no config — the client loads those as static files', async () => {
  const { token } = await seedShareLink('default');
  const { body } = await verifyShare(token);

  assert.equal(body.presentation.theme, 'default');
  assert.equal(
    body.presentation.themeConfig,
    null,
    'a built-in theme is a public file; nothing to ride along',
  );
});

test('the theme payload is the render projection, not the stored row', async () => {
  // Same rule as the deck payload next to it: the viewer needs a theme, not
  // the theme's private life. Who made it, which organization owns it and
  // whether it is the default are all absent by construction —
  // `buildThemeConfig` builds a render config from the row rather than
  // forwarding it.
  const theme = await seedCustomTheme();
  const { token } = await seedShareLink(theme.id);
  const { body } = await verifyShare(token);

  const keys = Object.keys(body.presentation.themeConfig);
  for (const leak of [
    'organizationId',
    'organization_id',
    'createdBy',
    'created_by',
    'createdAt',
    'updatedAt',
    'isDefault',
  ]) {
    assert.equal(keys.includes(leak), false, `${leak} does not travel`);
  }
});

// ---------------------------------------------------------------------------
// Surface 2 — the follow-along audience
// ---------------------------------------------------------------------------

async function followPresentation(presentationId) {
  const res = fakeRes();
  await handleFollowPresentation(
    {
      repoRoot: REPO_ROOT,
      req: fakeReq({ method: 'GET' }),
      res,
      url: new URL(
        `/api/follow/${presentationId}/presentation`,
        'http://localhost',
      ),
    },
    presentationId,
  );
  return { res, body: jsonBody(res) };
}

test('the follow audience gets the theme with the deck the follow code authorizes', async () => {
  const theme = await seedCustomTheme('#00ccaa');
  const pres = await seedDeck(theme.id);
  await goLive(pres);

  const { res, body } = await followPresentation(pres.id);
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, 'live');
  assert.equal(body.presentation.theme, theme.id);
  assert.equal(body.presentation.themeConfig?._customThemeId, theme.id);
  assert.equal(
    body.presentation.themeConfig.cssVars['--t-color-accent'],
    '#00ccaa',
  );
});

test('a built-in theme sends no config to the follow audience either', async () => {
  const pres = await seedDeck('default');
  await goLive(pres);

  const { body } = await followPresentation(pres.id);
  assert.equal(body.presentation.themeConfig, null);
});

// ---------------------------------------------------------------------------
// Surface 3 — the notes companion
// ---------------------------------------------------------------------------

async function sessionDeck(sessionId) {
  const res = fakeRes();
  await handleLiveSessionsPublic({
    repoRoot: REPO_ROOT,
    req: fakeReq({ method: 'GET' }),
    res,
    url: new URL(`/api/live-sessions/${sessionId}/deck`, 'http://localhost'),
  });
  return { res, body: jsonBody(res) };
}

test('the notes companion gets the theme with the session deck', async () => {
  const theme = await seedCustomTheme('#7744ff');
  const pres = await seedDeck(theme.id);
  const sessionId = await goLive(pres);

  const { res, body } = await sessionDeck(sessionId);
  assert.equal(res.statusCode, 200);
  assert.equal(body.theme, theme.id);
  assert.equal(body.themeConfig?._customThemeId, theme.id);
  assert.equal(body.themeConfig.cssVars['--t-color-accent'], '#7744ff');
});

test('a built-in theme sends no config to the notes companion either', async () => {
  const pres = await seedDeck('default');
  const sessionId = await goLive(pres);

  const { body } = await sessionDeck(sessionId);
  assert.equal(body.themeConfig, null);
});
