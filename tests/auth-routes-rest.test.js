/**
 * The remaining auth-adjacent route modules: SSO, profile image, user lookup
 * (test-coverage gap map, B40 — surface 2, "auth-routes-rest").
 *
 * `server/routes/api/{sso,profile,users}.js` are the three route modules from
 * surface 2 that the earlier auth-routes work left untested: the
 * password-reset / magic-link half shipped in PR 3 (#625) and the SSO *config*
 * + claim mapping already had `tests/sso-config.test.js` /
 * `tests/sso-oidc-claims.test.js`. What was missing is the route layer itself —
 * how the OIDC endpoints behave when SSO is off or a callback arrives without a
 * valid state, who may search the org's people and look up a profile, and who
 * may change whose profile image.
 *
 * Three rules carry this surface and are stated here as assertions:
 *
 *   1. **The SSO endpoints are inert unless SSO is configured, and the callback
 *      trusts nothing but a signed, unexpired state cookie.** With SSO off both
 *      routes bounce to `/login?error=sso_disabled`; with SSO on, a callback
 *      that carries no state — or a tampered one — is refused
 *      (`/login?error=sso_state`) and the rejection is audited, all before any
 *      token exchange.
 *   2. **A profile lookup requires a session and an image change respects
 *      ownership.** `/api/profile/*` 401s an anonymous caller; a normal user may
 *      only clear/replace *their own* image (the target is always
 *      `authedUser.email`), and the `/:email` admin route refuses a non-admin
 *      with a 403 — after validating the target address, so a malformed one is
 *      a 400 for anyone.
 *   3. **User search and profile lookup are org-scoped and authenticated.**
 *      Search only returns people in the caller's organization; the batch
 *      profile lookup refuses an unauthenticated caller (401) to keep it from
 *      becoming an enumeration oracle.
 *
 * Feasibility note (opt-out, logged in briefs/test-coverage-gaps.md): the SSO
 * *login* build and the *successful* callback both reach `openid-client`
 * discovery / token exchange against a live IdP (`buildLoginRequest` /
 * `completeLogin`), and the profile *upload* path runs Sharp against a media
 * provider — neither has a seam this recipe can drive without a network peer or
 * a configured provider. Those are pinned at the branches before that boundary
 * (SSO-disabled, state-CSRF; media-not-initialized); the same class as the
 * LLM-vendor and browser opt-outs already in the brief.
 *
 * House shape (see `tests/auth-routes-reset-and-magic-link.test.js`,
 * `tests/collaborators-permission-model.test.js`): the exported module handler
 * is called directly with a req/res double over `tests/helpers/fake-db.js`. The
 * SSO routes take a PublicContext; profile/users take the post-auth context
 * with `authedUser` + `createStorageScope`. No HTTP server, no browser.
 *
 * Run with: node --test tests/auth-routes-rest.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
// Make sure no ambient SSO config leaks in from the environment; each SSO test
// sets exactly what it needs.
for (const k of ['SSO_ENABLED', 'SSO_PROVIDER', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI']) {
  delete process.env[k];
}

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { createStorageScope } = await import('../server/utils/context.js');
const { handleSso } = await import('../server/routes/api/sso.js');
const { handleProfile } = await import('../server/routes/api/profile.js');
const { handleUsers } = await import('../server/routes/api/users.js');

/** @typedef {{email: string, name: string, organizationId: string, isAdmin?: boolean}} Actor */

const ACTORS = {
  owner: { email: 'owner@example.com', name: 'Olive Owner', organizationId: ORG },
  viewer: { email: 'viewer@example.com', name: 'Vera Viewer', organizationId: ORG },
  admin: { email: 'admin@example.com', name: 'Ada Admin', organizationId: ORG, isAdmin: true },
  outsider: { email: 'otto@other.example', name: 'Otto Outsider', organizationId: OTHER_ORG },
};

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** @param {Actor} actor */
function userRow(actor) {
  return {
    id: `user-${actor.email.split('@')[0]}`,
    organization_id: actor.organizationId,
    email: actor.email,
    name: actor.name,
    role: actor.isAdmin ? 'admin' : 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/** A `user_settings` row keyed by both id and email so either read branch finds it. */
function settingsRow(actor, profile) {
  return {
    user_id: `user-${actor.email.split('@')[0]}`,
    email: actor.email,
    settings: { profile },
  };
}

/** Reinstall a freshly seeded double. */
function seed() {
  db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: Object.values(ACTORS).map(userRow),
    user_settings: [
      settingsRow(ACTORS.viewer, { name: 'Vera Viewer', imageUrl: 'https://cdn.example/vera.png' }),
    ],
    auth_audit_log: [],
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Driving the module handlers
// ---------------------------------------------------------------------------

/** A response double capturing the status/headers/body the helpers write. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    raw: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    appendHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers) Object.assign(this.headers, headers);
      return this;
    },
    end(payload) {
      this.raw = payload ?? null;
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = null;
      }
      return this;
    },
  };
}

/**
 * Call a module entry handler (`handleSso`/`handleProfile`/`handleUsers`) the
 * way `routes/api/index.js` does — it self-dispatches on method + path.
 *
 * @param {Function} handler
 * @param {string} method
 * @param {string} path
 * @param {Object} [options]
 * @param {Actor|null} [options.as] - Acting user; omit for anonymous.
 * @param {Object} [options.body] - JSON request body.
 * @param {string} [options.cookie] - Cookie header value.
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(handler, method, path, { as = null, body, cookie } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const headers = { host: 'decks.example.test', 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const req = {
    method,
    headers,
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const authedUser = as || undefined;
  const handled = await handler({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test${path}`),
    authedUser,
  });
  return { handled, res };
}

/** Run `fn` with a complete OIDC configuration in the environment, then restore. */
async function withSsoEnabled(fn) {
  const env = {
    SSO_ENABLED: 'true',
    SSO_PROVIDER: 'oidc',
    OIDC_ISSUER_URL: 'https://idp.example.com',
    OIDC_CLIENT_ID: 'client-abc',
    OIDC_CLIENT_SECRET: 'secret-xyz',
    OIDC_REDIRECT_URI: 'https://decks.example.test/api/auth/oidc/callback',
  };
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const auditRows = () => db.__tables.auth_audit_log || [];

// ===========================================================================
// sso.js — inert unless configured; the callback trusts only a signed state
// ===========================================================================

test('login bounces to sso_disabled when SSO is off', async () => {
  seed();
  const { res, handled } = await call(handleSso, 'GET', '/api/auth/oidc/login');

  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/login?error=sso_disabled');
});

test('callback bounces to sso_disabled when SSO is off', async () => {
  seed();
  const { res } = await call(handleSso, 'GET', '/api/auth/oidc/callback?code=abc&state=def');

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/login?error=sso_disabled');
});

test('a callback with SSO on but no state cookie is refused and audited', async () => {
  seed();
  await withSsoEnabled(async () => {
    const { res } = await call(handleSso, 'GET', '/api/auth/oidc/callback?code=abc&state=def');

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, '/login?error=sso_state');
  });

  const failures = auditRows().filter((e) => e.event_type === 'sso_login');
  assert.equal(failures.length, 1, 'the rejection is recorded');
  assert.equal(failures[0].success, false);
  assert.equal(failures[0].metadata.reason, 'missing_state');
});

test('a callback with a tampered state cookie is refused before any token exchange', async () => {
  seed();
  await withSsoEnabled(async () => {
    const { res } = await call(handleSso, 'GET', '/api/auth/oidc/callback?code=abc&state=def', {
      cookie: 'sb_oidc=forged.notasignature',
    });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, '/login?error=sso_state');
  });
});

test('handleSso ignores a path outside its prefix', async () => {
  seed();
  const { res, handled } = await call(handleSso, 'GET', '/api/users/search?q=x');

  assert.equal(handled, false, 'not this module’s path');
  assert.equal(res.statusCode, null, 'and nothing was written');
});

test('the login route only answers GET', async () => {
  seed();
  const { res, handled } = await call(handleSso, 'POST', '/api/auth/oidc/login');

  assert.equal(handled, false, 'a POST falls through the GET-only route');
  assert.equal(res.statusCode, null);
});

// ===========================================================================
// users.js — org-scoped search, authenticated profile lookup
// ===========================================================================

test('search returns people in the caller’s organization, not others', async () => {
  seed();
  const { res } = await call(handleUsers, 'GET', '/api/users/search?q=example', { as: ACTORS.owner });

  assert.equal(res.statusCode, 200);
  const emails = res.body.users.map((u) => u.email).sort();
  assert.ok(emails.includes('viewer@example.com'), 'a same-org person is found');
  assert.ok(emails.includes('owner@example.com'));
  assert.ok(!emails.includes('otto@other.example'), 'a person in another org is not');
});

test('search with an empty query returns an empty list, no query', async () => {
  const db2 = seed();
  const { res } = await call(handleUsers, 'GET', '/api/users/search?q=', { as: ACTORS.owner });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.users, []);
  assert.deepEqual(db2.__queryLog, [], 'an empty query never reaches storage');
});

test('search honours the exclude list', async () => {
  seed();
  const { res } = await call(
    handleUsers,
    'GET',
    '/api/users/search?q=example&exclude=owner@example.com',
    { as: ACTORS.owner }
  );

  assert.equal(res.statusCode, 200);
  const emails = res.body.users.map((u) => u.email);
  assert.ok(!emails.includes('owner@example.com'), 'the excluded address is dropped');
  assert.ok(emails.includes('viewer@example.com'));
});

test('profile lookup refuses an unauthenticated caller with a 401', async () => {
  seed();
  const { res } = await call(handleUsers, 'GET', '/api/users/profiles?emails=viewer@example.com');

  assert.equal(res.statusCode, 401, 'the batch lookup is not an anonymous enumeration oracle');
  assert.equal(res.body.error, 'unauthorized');
});

test('profile lookup returns name and imageUrl per address', async () => {
  seed();
  const { res } = await call(
    handleUsers,
    'GET',
    '/api/users/profiles?emails=viewer@example.com,ghost@example.com',
    { as: ACTORS.owner }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profiles['viewer@example.com'].name, 'Vera Viewer');
  assert.equal(res.body.profiles['viewer@example.com'].imageUrl, 'https://cdn.example/vera.png');
  assert.deepEqual(
    res.body.profiles['ghost@example.com'],
    { name: '', imageUrl: '' },
    'an unknown address resolves to an empty profile, not an error'
  );
});

test('profile lookup with no addresses returns an empty map', async () => {
  seed();
  const { res } = await call(handleUsers, 'GET', '/api/users/profiles?emails=', { as: ACTORS.owner });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.profiles, {});
});

test('profile lookup only answers GET', async () => {
  seed();
  const { res } = await call(handleUsers, 'POST', '/api/users/profiles', { as: ACTORS.owner });

  assert.equal(res.statusCode, 405);
});

// ===========================================================================
// profile.js — a session is required; image ownership is enforced
// ===========================================================================

test('the profile surface refuses an anonymous caller with a 401', async () => {
  seed();
  const { res } = await call(handleProfile, 'DELETE', '/api/profile/image');

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('handleProfile ignores a path outside its prefix', async () => {
  seed();
  const { res, handled } = await call(handleProfile, 'GET', '/api/users/search', { as: ACTORS.owner });

  assert.equal(handled, false);
  assert.equal(res.statusCode, null);
});

test('a user may clear their own profile image', async () => {
  seed();
  const { res } = await call(handleProfile, 'DELETE', '/api/profile/image', { as: ACTORS.viewer });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('an own-image upload without a media provider is a 400, not a crash', async () => {
  seed();
  const { res } = await call(handleProfile, 'POST', '/api/profile/image', {
    as: ACTORS.owner,
    body: { dataUrl: 'data:image/png;base64,AAAA' },
  });

  assert.equal(res.statusCode, 400, 'the media-provider guard short-circuits before Sharp');
});

test('an unsupported method on the own-image route is a 405', async () => {
  seed();
  const { res } = await call(handleProfile, 'PATCH', '/api/profile/image', { as: ACTORS.owner });

  assert.equal(res.statusCode, 405);
});

test('the admin image route refuses a non-admin with a 403', async () => {
  seed();
  const { res } = await call(handleProfile, 'DELETE', '/api/profile/image/viewer@example.com', {
    as: ACTORS.owner, // a normal user, not an admin
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('the admin image route rejects a malformed target address with a 400', async () => {
  seed();
  const { res } = await call(handleProfile, 'DELETE', '/api/profile/image/not-an-address', {
    as: ACTORS.admin,
  });

  assert.equal(res.statusCode, 400, 'the address is validated before anything is written');
});

test('an admin may clear another user’s image', async () => {
  seed();
  const { res } = await call(handleProfile, 'DELETE', '/api/profile/image/viewer@example.com', {
    as: ACTORS.admin,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('an admin upload without a media provider is a 400, after the admin check', async () => {
  seed();
  const { res } = await call(handleProfile, 'POST', '/api/profile/image/viewer@example.com', {
    as: ACTORS.admin,
    body: { dataUrl: 'data:image/png;base64,AAAA' },
  });

  assert.equal(res.statusCode, 400);
});
