import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { createFakeDb } from './helpers/fake-db.js';

// Auth/features read some settings at import time; each test file is isolated.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.AUTH_ENABLED = 'true';
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_ORG_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.BREVO_API_KEY = 'test-key-not-a-secret';
process.env.BREVO_SENDER_EMAIL = 'noreply@decks.example.test';
for (const key of Object.keys(process.env)) {
  if (key.startsWith('OIDC_') || key.startsWith('SSO_'))
    delete process.env[key];
}

const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const { hashToken } = await import('../server/utils/secure-tokens.js');
const { handleAuth } = await import('../server/routes/api/auth.js');
const { handleMagicLink } = await import('../server/routes/api/magic-link.js');
const { handlePasswordReset } =
  await import('../server/routes/api/password-reset.js');
const { BREVO_API_URL } = await import('../server/integrations/email/index.js');

const EMAIL = 'alice@example.com';
const PASSWORD = 'correct horse battery';
const FULL = {
  SSO_ENABLED: 'true',
  SSO_ENFORCE: 'true',
  SSO_PROVIDER: 'oidc',
  OIDC_ISSUER_URL: 'https://idp.example.test',
  OIDC_CLIENT_ID: 'test-client',
  OIDC_CLIENT_SECRET: 'test-client-secret',
  OIDC_REDIRECT_URI: 'https://decks.example.test/api/auth/oidc/callback',
};
const requests = [
  {
    handler: handleAuth,
    path: '/api/auth/login',
    body: { email: EMAIL, password: PASSWORD },
  },
  {
    handler: handleMagicLink,
    path: '/api/auth/magic-link',
    body: { email: EMAIL },
    table: 'magic_link_tokens',
  },
  {
    handler: handlePasswordReset,
    path: '/api/auth/forgot-password',
    body: { email: EMAIL },
    table: 'password_reset_tokens',
  },
];
const redemptions = [
  {
    handler: handleMagicLink,
    path: '/api/auth/magic-link/verify',
    body: { token: 'issued-before-enforcement' },
    table: 'magic_link_tokens',
  },
  {
    handler: handlePasswordReset,
    path: '/api/auth/reset-password',
    body: {
      token: 'issued-before-enforcement',
      password: 'a-new-valid-password',
    },
    table: 'password_reset_tokens',
  },
];
let passwordHash;
let db;
let mails;
let ip = 0;

test.before(async () => {
  passwordHash = await hashPassword(PASSWORD);
});
test.beforeEach((t) => {
  Object.assign(process.env, FULL);
  mails = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, BREVO_API_URL);
    mails.push(JSON.parse(options.body));
    return { ok: true, status: 201 };
  });
  db = createFakeDb({
    organizations: [
      {
        id: process.env.DEFAULT_ORGANIZATION_ID,
        name: 'Default',
        slug: 'default',
      },
    ],
    users: [
      {
        id: 'user-alice',
        organization_id: process.env.DEFAULT_ORGANIZATION_ID,
        email: EMAIL,
        name: 'Alice',
        role: 'user',
        auth_source: 'database',
        password_hash: passwordHash,
        settings: {},
      },
    ],
    password_reset_tokens: [],
    magic_link_tokens: [],
    auth_audit_log: [],
  });
  __setTestDb(db);
});
test.afterEach(() => {
  __setTestDb(null);
});

async function call({ handler, path, body }) {
  const req = createMockReq({
    method: 'POST',
    body,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
  });
  req.socket.remoteAddress = `203.0.113.${++ip}`;
  const res = createMockRes();
  assert.equal(
    await handler({
      repoRoot: process.cwd(),
      req,
      res,
      url: new URL(path, 'https://decks.example.test'),
    }),
    true,
  );
  // Mail is fire-and-forget; drain its awaited fake-DB operations before checking.
  await setImmediate();
  return res;
}

for (const route of requests) {
  for (const email of [EMAIL, 'unknown@example.com', 'invalid']) {
    test(`${route.path}: enforced SSO refuses ${email} without effects`, async () => {
      const before = structuredClone(db.__tables);
      const res = await call({ ...route, body: { ...route.body, email } });
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.json(), { ok: false, error: 'sso_required' });
      assert.equal(res.headers['Set-Cookie'], undefined);
      assert.deepEqual(db.__tables, before, 'no token, user or audit writes');
      assert.deepEqual(mails, []);
    });
  }
}

const unenforced = [
  ['enforcement off', { SSO_ENFORCE: 'false' }],
  ['SSO off', { SSO_ENABLED: 'false' }],
  ['missing client secret', { OIDC_CLIENT_SECRET: '' }],
  ['invalid issuer', { OIDC_ISSUER_URL: 'not-a-url' }],
  ['invalid redirect', { OIDC_REDIRECT_URI: 'not-a-url' }],
  ['unsupported provider', { SSO_PROVIDER: 'saml' }],
];
for (const [label, config] of unenforced) {
  for (const route of requests) {
    test(`${route.path}: ${label} preserves working local authentication`, async () => {
      Object.assign(process.env, config);
      const res = await call(route);
      assert.equal(res.statusCode, 200);
      if (route.table) {
        assert.equal(res.json().ok, true);
        assert.equal(db.__tables[route.table].length, 1);
        assert.equal(mails.length, 1, 'the mail path actually runs');
        assert.equal(mails[0].to[0].email, EMAIL);
      } else {
        assert.equal(res.json().user.email, EMAIL);
        assert.ok(res.headers['Set-Cookie'], 'successful password login');
      }
    });
  }
}

for (const route of redemptions) {
  for (const enforced of [true, false]) {
    test(`${route.path}: existing token with enforcement ${enforced}`, async () => {
      process.env.SSO_ENFORCE = String(enforced);
      db.__tables[route.table].push({
        id: 'existing-token',
        user_email: EMAIL,
        token_hash: hashToken(route.body.token),
        used_at: null,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        created_at: new Date().toISOString(),
      });
      const before = structuredClone(db.__tables);
      const res = await call(route);
      if (enforced) {
        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.json(), { ok: false, error: 'sso_required' });
        assert.deepEqual(
          db.__tables,
          before,
          'no token consumption or password change',
        );
        assert.equal(res.headers['Set-Cookie'], undefined);
      } else {
        assert.equal(res.statusCode, 200);
        assert.equal(res.json().ok, true);
        if (route.table === 'magic_link_tokens') {
          assert.ok(res.headers['Set-Cookie']);
        } else {
          assert.notEqual(db.__tables.users[0].password_hash, passwordHash);
        }
        assert.ok(db.__tables[route.table][0].used_at);
      }
      assert.deepEqual(mails, []);
    });
  }
}
