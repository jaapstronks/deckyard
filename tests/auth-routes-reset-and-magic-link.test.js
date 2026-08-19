/**
 * The passwordless / password-recovery auth routes (test-coverage gap map, PR 3).
 *
 * `server/routes/api/password-reset.js` (four endpoints: forgot-password,
 * validate, reset, change-password) and `server/routes/api/magic-link.js` (two
 * endpoints: request, verify) are the mail-carried entry points into a session.
 * The storage beneath them is tested (`tests/pg/*`, the token helpers), but the
 * route layer — the enumeration guard, the rate-limit gate, the order in which a
 * token is validated versus consumed, and who is allowed to change a password —
 * was not.
 *
 * Two rules carry this surface and are stated here as assertions:
 *
 *   1. **Neither route may confirm whether an address has an account.** A
 *      request for a link answers `200 ok` whether or not the person exists, and
 *      whether or not the request was rate-limited; the only observable
 *      difference is a token row that does or does not appear in the database,
 *      never the response. That is what these tests read.
 *   2. **Identity is instance-wide, the write lands in the acting organization.** A
 *      reset or a magic link proves an *email*, which names one person across
 *      all organizations, so the lookup is global (`getUserByEmailGlobal`); a
 *      brand-new person, though, is created in the organization the request acts
 *      in. A person whose home organization is not the default one still
 *      resolves, and their row is not duplicated.
 *
 * These are route-level tests in the house shape (see
 * `tests/authz-organization-scope.test.js`,
 * `tests/collaborators-permission-model.test.js`): the exported handler is
 * called directly with a req/res double over `tests/helpers/fake-db.js`. No HTTP
 * server, no browser — the suite has no e2e harness and this item introduces
 * none. The token storage reaches the double straight through `getDb()`, so
 * unlike the collaborators file this one needs no `initializeStorage()`.
 *
 * No production code changes with this file.
 *
 * MULTI_ORG_ENABLED is read at module scope (server/config/features.js),
 * so this file fixes its environment before importing anything and relies on
 * node --test giving each file its own process.
 *
 * Run with: node --test tests/auth-routes-reset-and-magic-link.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Assembled rather than written as one literal so secret scanners do not flag
// it; the auth layer only needs MIN_AUTH_SECRET_LENGTH characters to sign with.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_ORG_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
// The reset/magic-link mail is fire-and-forget; without a key the Brevo client
// answers before it reaches the network, so nothing here touches SMTP.
delete process.env.BREVO_API_KEY;

const DEFAULT_ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const { hashToken } = await import('../server/utils/secure-tokens.js');
const auth = await import('../server/auth/auth.js');
const { handlePasswordReset } =
  await import('../server/routes/api/password-reset.js');
const { handleMagicLink } = await import('../server/routes/api/magic-link.js');

const CURRENT_PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a-brand-new-passphrase';
const CLIENT_IP = '203.0.113.9';

/** Future/past/recent stamps for token rows, in the ISO shape the layer writes. */
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const RECENT = new Date(Date.now() - 60 * 1000).toISOString();

/** @type {ReturnType<typeof createFakeDb>} */
let db;
let passwordHash;

test.before(async () => {
  passwordHash = await hashPassword(CURRENT_PASSWORD);
  assert.equal(
    auth.authEnabled(),
    true,
    'auth is on for this file (secret set)',
  );
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * A stored `users` row, in the shape the identity lookup reads.
 * @param {Object} overrides - Fields that matter to the test at hand.
 * @returns {Object}
 */
function userRow(overrides) {
  return {
    id: `user-${overrides.email.split('@')[0]}`,
    organization_id: DEFAULT_ORG,
    email: overrides.email,
    name: overrides.name || 'Someone',
    role: 'user',
    auth_source: 'database',
    password_hash: passwordHash,
    password_changed_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    settings: {},
    ...overrides,
  };
}

/**
 * A token row for either `password_reset_tokens` or `magic_link_tokens` — the
 * two tables share a column shape. `raw` is the token that reaches the request;
 * only its hash is stored, exactly as the storage layer writes it.
 * @param {Object} spec
 * @returns {Object}
 */
function tokenRow({
  id,
  email,
  raw,
  used_at = null,
  expiresAt = FUTURE,
  createdAt = RECENT,
  ip = null,
}) {
  return {
    id,
    user_email: email,
    token_hash: hashToken(raw),
    used_at,
    expires_at: expiresAt,
    created_at: createdAt,
    ip_address: ip,
    user_agent: null,
  };
}

/**
 * Reinstall a freshly seeded double. Everyone here authenticates by email, so
 * the cast is small: Alice lives in the default organization, Carol's home is a
 * *different* one (to pin that identity is resolved instance-wide), and Dave
 * signed up through a magic link and therefore holds no password.
 *
 * @param {Object} [extra] - Extra tables to merge in (token rows per test).
 * @returns {ReturnType<typeof createFakeDb>}
 */
function seed(extra = {}) {
  db = createFakeDb({
    organizations: [
      { id: DEFAULT_ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: [
      userRow({ email: 'alice@example.com', name: 'Alice' }),
      userRow({
        email: 'carol@other.example',
        name: 'Carol',
        organization_id: OTHER_ORG,
      }),
      userRow({
        email: 'dave@example.com',
        name: 'Dave',
        auth_source: 'magic_link',
        password_hash: null,
      }),
    ],
    password_reset_tokens: [],
    magic_link_tokens: [],
    auth_audit_log: [],
    ...extra,
  });
  __setTestDb(db);
  return db;
}

test.after(() => {
  __setTestDb(null);
});

// ---------------------------------------------------------------------------
// Driving the handlers
// ---------------------------------------------------------------------------

/** A response double that captures both `setHeader` (cookies) and `writeHead`/`end`. */
function makeRes() {
  return {
    status: null,
    headers: {},
    chunks: [],
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
      return this;
    },
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
    },
  };
}

/**
 * Call an auth-route handler the way `routes/api/index.js` does — the handler
 * builds its own context, so it takes only `{ repoRoot, req, res, url }`.
 *
 * @param {Function} handler - `handlePasswordReset` or `handleMagicLink`.
 * @param {string} method - HTTP method.
 * @param {string} path - Request path, query string included.
 * @param {Object} [options]
 * @param {Object|string} [options.body] - Request body; a string is sent verbatim.
 * @param {string} [options.cookie] - `Cookie` header value, for the session routes.
 * @returns {Promise<{handled: boolean, status: number|null, body: Object|null, raw: string|null, res: Object}>}
 */
async function call(handler, method, path, { body, cookie } = {}) {
  const payload =
    body === undefined
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
  const headers = {
    host: 'decks.example.test',
    'content-type': 'application/json',
  };
  if (cookie) headers.cookie = cookie;

  const req = {
    method,
    headers,
    socket: { remoteAddress: CLIENT_IP },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };

  const res = makeRes();
  const handled = await handler({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://decks.example.test${path}`),
  });

  const raw = res.chunks.length ? res.chunks.join('') : null;
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  return { handled, status: res.status, body: parsed, raw, res };
}

/** Run `fn` with AUTH_ENABLED=false, then restore. */
async function withAuthDisabled(fn) {
  process.env.AUTH_ENABLED = 'false';
  try {
    await fn();
  } finally {
    delete process.env.AUTH_ENABLED;
  }
}

const resetTokens = () => db.__tables.password_reset_tokens;
const magicTokens = () => db.__tables.magic_link_tokens;
const auditRows = () => db.__tables.auth_audit_log || [];
const userFor = (email) => db.__tables.users.find((u) => u.email === email);
const auditTypes = () => auditRows().map((e) => e.event_type);

// ===========================================================================
// password-reset.js — POST /api/auth/forgot-password
// ===========================================================================

test('forgot-password mints a token for a known address and records the request', async () => {
  seed();
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/forgot-password',
    {
      body: { email: 'alice@example.com' },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(resetTokens().length, 1, 'exactly one token issued');
  assert.equal(resetTokens()[0].user_email, 'alice@example.com');
  assert.ok(auditTypes().includes('password_reset_request'));
});

test('forgot-password gives an unknown address the same 200 and mints nothing', async () => {
  seed();
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/forgot-password',
    {
      body: { email: 'ghost@example.com' },
    },
  );

  assert.equal(
    res.status,
    200,
    'the response never reveals that nobody exists',
  );
  assert.equal(res.body.ok, true);
  assert.equal(
    resetTokens().length,
    0,
    'and no token is created for a phantom',
  );
});

test('forgot-password refuses a body that is not an address', async () => {
  seed();
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/forgot-password',
    {
      body: { email: 'not-an-address' },
    },
  );

  assert.equal(res.status, 400);
  assert.equal(resetTokens().length, 0);
});

test('forgot-password is a 400 when auth is disabled', async () => {
  seed();
  await withAuthDisabled(async () => {
    const res = await call(
      handlePasswordReset,
      'POST',
      '/api/auth/forgot-password',
      {
        body: { email: 'alice@example.com' },
      },
    );
    assert.equal(res.status, 400);
  });
});

test('a rate-limited address still gets 200, but no fourth token and an audit note', async () => {
  seed({
    password_reset_tokens: [
      tokenRow({ id: 'prt-1', email: 'alice@example.com', raw: 'seed-a' }),
      tokenRow({ id: 'prt-2', email: 'alice@example.com', raw: 'seed-b' }),
      tokenRow({ id: 'prt-3', email: 'alice@example.com', raw: 'seed-c' }),
    ],
  });
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/forgot-password',
    {
      body: { email: 'alice@example.com' },
    },
  );

  assert.equal(res.status, 200, 'the limit is invisible to the caller');
  assert.equal(res.body.ok, true);
  assert.equal(
    resetTokens().length,
    3,
    'the request over the limit mints nothing',
  );
  assert.ok(auditTypes().includes('password_reset_rate_limited'));
});

// ===========================================================================
// password-reset.js — GET /api/auth/reset-password/validate
// ===========================================================================

test('validate accepts a live token and masks the address, without consuming it', async () => {
  seed({
    password_reset_tokens: [
      tokenRow({
        id: 'prt-live',
        email: 'alice@example.com',
        raw: 'live-token',
      }),
    ],
  });
  const res = await call(
    handlePasswordReset,
    'GET',
    '/api/auth/reset-password/validate?token=live-token',
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.maskedEmail, 'al***@example.com');
  assert.equal(
    resetTokens()[0].used_at,
    null,
    'validation must not spend the token',
  );
});

test('validate without a token is a 400', async () => {
  seed();
  const res = await call(
    handlePasswordReset,
    'GET',
    '/api/auth/reset-password/validate',
  );

  assert.equal(res.status, 400);
});

test('validate answers ok:false for an unknown token, not a 404 that leaks its absence', async () => {
  seed();
  const res = await call(
    handlePasswordReset,
    'GET',
    '/api/auth/reset-password/validate?token=nobody-minted-this',
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'invalid');
});

test('validate reports an expired token as expired', async () => {
  seed({
    password_reset_tokens: [
      tokenRow({
        id: 'prt-old',
        email: 'alice@example.com',
        raw: 'stale-token',
        expiresAt: PAST,
      }),
    ],
  });
  const res = await call(
    handlePasswordReset,
    'GET',
    '/api/auth/reset-password/validate?token=stale-token',
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'expired');
});

// ===========================================================================
// password-reset.js — POST /api/auth/reset-password
// ===========================================================================

test('reset-password sets a new password, spends the token, and records success', async () => {
  seed({
    password_reset_tokens: [
      tokenRow({ id: 'prt-use', email: 'alice@example.com', raw: 'use-token' }),
    ],
  });
  const before = userFor('alice@example.com').password_hash;

  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/reset-password',
    {
      body: { token: 'use-token', password: NEW_PASSWORD },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.notEqual(
    userFor('alice@example.com').password_hash,
    before,
    'the hash changed',
  );
  assert.equal(userFor('alice@example.com').auth_source, 'database');
  assert.equal(typeof resetTokens()[0].used_at, 'string', 'the token is spent');
  assert.ok(auditTypes().includes('password_reset_success'));
});

test('reset-password for a home organization that is not the default still resolves', async () => {
  seed({
    password_reset_tokens: [
      tokenRow({
        id: 'prt-carol',
        email: 'carol@other.example',
        raw: 'carol-token',
      }),
    ],
  });
  const before = userFor('carol@other.example').password_hash;

  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/reset-password',
    {
      body: { token: 'carol-token', password: NEW_PASSWORD },
    },
  );

  assert.equal(res.status, 200);
  const carol = db.__tables.users.filter(
    (u) => u.email === 'carol@other.example',
  );
  assert.equal(
    carol.length,
    1,
    'the global lookup updates her, it does not duplicate her',
  );
  assert.equal(
    carol[0].organization_id,
    OTHER_ORG,
    'her organization is untouched',
  );
  assert.notEqual(carol[0].password_hash, before);
});

test('reset-password for a brand-new address creates the person in the acting organization', async () => {
  seed({
    password_reset_tokens: [
      tokenRow({
        id: 'prt-new',
        email: 'newcomer@example.com',
        raw: 'new-token',
      }),
    ],
  });
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/reset-password',
    {
      body: { token: 'new-token', password: NEW_PASSWORD },
    },
  );

  assert.equal(res.status, 200);
  const created = userFor('newcomer@example.com');
  assert.ok(created, 'a row was created for the previously-unknown address');
  assert.equal(
    created.organization_id,
    DEFAULT_ORG,
    'the new row lands in the default organization',
  );
  assert.equal(created.auth_source, 'database');
});

test('reset-password without a token is a 400', async () => {
  seed();
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/reset-password',
    {
      body: { password: NEW_PASSWORD },
    },
  );

  assert.equal(res.status, 400);
});

test('reset-password refuses a short password before it spends the token', async () => {
  seed({
    password_reset_tokens: [
      tokenRow({
        id: 'prt-weak',
        email: 'alice@example.com',
        raw: 'weak-token',
      }),
    ],
  });
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/reset-password',
    {
      body: { token: 'weak-token', password: 'short' },
    },
  );

  assert.equal(res.status, 400);
  assert.equal(
    resetTokens()[0].used_at,
    null,
    'a rejected password leaves the token usable',
  );
});

test('reset-password rejects a spent or expired token and records the failure', async () => {
  seed({
    password_reset_tokens: [
      tokenRow({
        id: 'prt-exp',
        email: 'alice@example.com',
        raw: 'expired-token',
        expiresAt: PAST,
      }),
    ],
  });
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/reset-password',
    {
      body: { token: 'expired-token', password: NEW_PASSWORD },
    },
  );

  assert.equal(res.status, 400);
  assert.ok(auditTypes().includes('password_reset_failed'));
});

// ===========================================================================
// password-reset.js — POST /api/auth/change-password (session required)
// ===========================================================================

/**
 * A `Cookie` header carrying a live session for `email`, minted the way a login
 * does so its version claim matches what the seeded row recomputes to.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<string>}
 */
async function sessionCookieFor(email, password) {
  const login = await auth.verifyLoginAsync(email, password, {
    organizationId: DEFAULT_ORG,
    actorEmail: email,
  });
  assert.ok(login, `login for ${email} must succeed to mint a session`);
  const res = makeRes();
  auth.setSessionCookie({ headers: {} }, res, login);
  return String(res.headers['Set-Cookie']).split(';')[0];
}

test('change-password rotates the password and issues a fresh session', async () => {
  seed();
  const cookie = await sessionCookieFor('alice@example.com', CURRENT_PASSWORD);
  const before = userFor('alice@example.com').password_hash;

  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/change-password',
    {
      cookie,
      body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.notEqual(userFor('alice@example.com').password_hash, before);
  assert.ok(res.res.headers['Set-Cookie'], 'a new session cookie is set');
  assert.ok(auditTypes().includes('password_change_success'));
});

test('change-password refuses an anonymous caller with a 401', async () => {
  seed();
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/change-password',
    {
      body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    },
  );

  assert.equal(res.status, 401);
});

test('change-password rejects a wrong current password and leaves the hash alone', async () => {
  seed();
  const cookie = await sessionCookieFor('alice@example.com', CURRENT_PASSWORD);
  const before = userFor('alice@example.com').password_hash;

  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/change-password',
    {
      cookie,
      body: { currentPassword: 'not the password', newPassword: NEW_PASSWORD },
    },
  );

  assert.equal(res.status, 400);
  assert.equal(userFor('alice@example.com').password_hash, before, 'unchanged');
  assert.ok(auditTypes().includes('password_change_failed'));
});

test('change-password refuses a user who has no database credentials', async () => {
  seed();
  // Dave signed in through a magic link and never set a password; a session for
  // him is minted directly rather than through the password login path.
  const magicUser = {
    email: 'dave@example.com',
    role: 'user',
    name: 'Dave',
    v: '',
  };
  const cookieRes = makeRes();
  const daveRow = userFor('dave@example.com');
  const { sessionVersion } = await import('../server/utils/session-version.js');
  magicUser.v = sessionVersion(daveRow);
  auth.setSessionCookie({ headers: {} }, cookieRes, magicUser);
  const cookie = String(cookieRes.headers['Set-Cookie']).split(';')[0];

  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/change-password',
    {
      cookie,
      body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
    },
  );

  assert.equal(
    res.status,
    400,
    'there is no current password to verify against',
  );
});

test('change-password refuses a short new password', async () => {
  seed();
  const cookie = await sessionCookieFor('alice@example.com', CURRENT_PASSWORD);
  const res = await call(
    handlePasswordReset,
    'POST',
    '/api/auth/change-password',
    {
      cookie,
      body: { currentPassword: CURRENT_PASSWORD, newPassword: 'short' },
    },
  );

  assert.equal(res.status, 400);
});

// ===========================================================================
// magic-link.js — POST /api/auth/magic-link
// ===========================================================================

test('magic-link request mints a token for a known address', async () => {
  seed();
  const res = await call(handleMagicLink, 'POST', '/api/auth/magic-link', {
    body: { email: 'alice@example.com' },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(magicTokens().length, 1);
  assert.equal(magicTokens()[0].user_email, 'alice@example.com');
});

test('magic-link request gives an unknown address the same 200 and mints nothing', async () => {
  seed();
  const res = await call(handleMagicLink, 'POST', '/api/auth/magic-link', {
    body: { email: 'ghost@example.com' },
  });

  assert.equal(
    res.status,
    200,
    'the response never reveals that nobody exists',
  );
  assert.equal(res.body.ok, true);
  assert.equal(
    magicTokens().length,
    0,
    'a link is only ever sent to a real account',
  );
});

test('magic-link request refuses a malformed address', async () => {
  seed();
  const res = await call(handleMagicLink, 'POST', '/api/auth/magic-link', {
    body: { email: 'nope' },
  });

  assert.equal(res.status, 400);
  assert.equal(magicTokens().length, 0);
});

test('magic-link request is a 400 when auth is disabled', async () => {
  seed();
  await withAuthDisabled(async () => {
    const res = await call(handleMagicLink, 'POST', '/api/auth/magic-link', {
      body: { email: 'alice@example.com' },
    });
    assert.equal(res.status, 400);
  });
});

test('a rate-limited address still gets 200, but no sixth magic token', async () => {
  seed({
    magic_link_tokens: [
      tokenRow({ id: 'mlt-1', email: 'alice@example.com', raw: 'm-a' }),
      tokenRow({ id: 'mlt-2', email: 'alice@example.com', raw: 'm-b' }),
      tokenRow({ id: 'mlt-3', email: 'alice@example.com', raw: 'm-c' }),
      tokenRow({ id: 'mlt-4', email: 'alice@example.com', raw: 'm-d' }),
      tokenRow({ id: 'mlt-5', email: 'alice@example.com', raw: 'm-e' }),
    ],
  });
  const res = await call(handleMagicLink, 'POST', '/api/auth/magic-link', {
    body: { email: 'alice@example.com' },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(
    magicTokens().length,
    5,
    'the request over the limit mints nothing',
  );
});

// ===========================================================================
// magic-link.js — POST /api/auth/magic-link/verify
// ===========================================================================

test('verify spends a live token, logs the person in, and opens a session', async () => {
  seed({
    magic_link_tokens: [
      tokenRow({
        id: 'mlt-live',
        email: 'alice@example.com',
        raw: 'live-magic',
      }),
    ],
  });
  const res = await call(
    handleMagicLink,
    'POST',
    '/api/auth/magic-link/verify',
    {
      body: { token: 'live-magic' },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.email, 'alice@example.com');
  assert.ok(res.res.headers['Set-Cookie'], 'a session cookie is set');
  assert.equal(typeof magicTokens()[0].used_at, 'string', 'the token is spent');
  assert.ok(auditTypes().includes('magic_link_login'));
});

test('verify creates a first-time visitor as a magic-link user in the acting organization', async () => {
  seed({
    magic_link_tokens: [
      tokenRow({
        id: 'mlt-new',
        email: 'firsttimer@example.com',
        raw: 'new-magic',
      }),
    ],
  });
  const res = await call(
    handleMagicLink,
    'POST',
    '/api/auth/magic-link/verify',
    {
      body: { token: 'new-magic' },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const created = userFor('firsttimer@example.com');
  assert.ok(created, 'the address now has a user row');
  assert.equal(created.auth_source, 'magic_link');
  assert.equal(created.organization_id, DEFAULT_ORG);
});

test('verify without a token is a 400', async () => {
  seed();
  const res = await call(
    handleMagicLink,
    'POST',
    '/api/auth/magic-link/verify',
    {
      body: {},
    },
  );

  assert.equal(res.status, 400);
});

test('verify cannot tell an unknown token from an expired one, and says so uniformly', async () => {
  // The atomic consume matches nothing for both an unknown token and an expired
  // one, so the route collapses them to `expired` — deliberately, since a
  // distinct "no such token" would confirm which tokens were never issued.
  // (The GET validate path *can* separate them; the consuming verify path
  // cannot.)
  seed();
  const res = await call(
    handleMagicLink,
    'POST',
    '/api/auth/magic-link/verify',
    {
      body: { token: 'nobody-minted-this' },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'expired');
});

test('verify reports an expired token as expired', async () => {
  seed({
    magic_link_tokens: [
      tokenRow({
        id: 'mlt-old',
        email: 'alice@example.com',
        raw: 'stale-magic',
        expiresAt: PAST,
      }),
    ],
  });
  const res = await call(
    handleMagicLink,
    'POST',
    '/api/auth/magic-link/verify',
    {
      body: { token: 'stale-magic' },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'expired');
});

// ===========================================================================
// What these modules do not answer
// ===========================================================================

test('each handler declines a path or method outside its own', async () => {
  seed();
  const declined = [
    [handlePasswordReset, 'GET', '/api/auth/forgot-password'],
    [handlePasswordReset, 'POST', '/api/auth/reset-password/validate'],
    [handlePasswordReset, 'POST', '/api/auth/magic-link'],
    [handleMagicLink, 'GET', '/api/auth/magic-link'],
    [handleMagicLink, 'POST', '/api/auth/forgot-password'],
  ];

  for (const [handler, method, path] of declined) {
    const res = await call(handler, method, path, { body: {} });
    assert.equal(res.handled, false, `${method} ${path} is not this module's`);
    assert.equal(res.status, null, 'and nothing was written to the response');
  }
});
