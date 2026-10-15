/**
 * A fresh install gets its first admin from `AUTH_ADMIN_EMAIL` (B381, D192).
 *
 * At boot, with auth on and an empty `users` table, the address becomes a
 * passwordless admin; magic link then sets up the first session. Pinned here:
 * the bootstrap fires only on an empty table, writes nothing otherwise, stays
 * off without auth, and the created row actually logs in, through magic link
 * without SSO and through the IdP under `SSO_ENFORCE` (which refuses magic
 * link, D188).
 *
 * Run with: node --test tests/first-admin-bootstrap.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { createFakeDb } from './helpers/fake-db.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.AUTH_ENABLED = 'true';
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_ORG_ENABLED;
delete process.env.SANDBOX_MODE;
delete process.env.DEMO_MODE;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.BREVO_API_KEY = 'test-key-not-a-secret';
process.env.BREVO_SENDER_EMAIL = 'noreply@decks.example.test';
for (const key of Object.keys(process.env)) {
  if (key.startsWith('OIDC_') || key.startsWith('SSO_'))
    delete process.env[key];
}

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const ADMIN = 'owner@example.com';
const SSO = {
  SSO_ENABLED: 'true',
  SSO_ENFORCE: 'true',
  SSO_PROVIDER: 'oidc',
  OIDC_ISSUER_URL: 'https://idp.example.test',
  OIDC_CLIENT_ID: 'test-client',
  OIDC_CLIENT_SECRET: 'test-client-secret',
  OIDC_REDIRECT_URI: 'https://decks.example.test/api/auth/oidc/callback',
};

const { __setTestDb } = await import('../server/db/client.js');
const { bootstrapFirstAdmin } = await import('../server/auth/first-admin.js');
const { handleMagicLink } = await import('../server/routes/api/magic-link.js');
const { getOrCreateSsoUser } = await import('../server/storage/sso.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { BREVO_API_URL } = await import('../server/integrations/email/index.js');

let db;
let mails;
let ip = 0;

test.beforeEach((t) => {
  process.env.AUTH_ADMIN_EMAIL = ADMIN;
  process.env.AUTH_ENABLED = 'true';
  for (const key of Object.keys(SSO)) delete process.env[key];
  mails = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, BREVO_API_URL);
    mails.push(JSON.parse(options.body));
    return { ok: true, status: 201 };
  });
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [],
    magic_link_tokens: [],
    password_reset_tokens: [],
    auth_audit_log: [],
  });
  __setTestDb(db);
});
test.afterEach(() => {
  __setTestDb(null);
});

async function post(path, body) {
  const req = createMockReq({
    method: 'POST',
    body,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
  });
  req.socket.remoteAddress = `203.0.113.${++ip}`;
  const res = createMockRes();
  await handleMagicLink({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(path, 'https://decks.example.test'),
  });
  await setImmediate();
  return res;
}

test('an empty user table gets the configured address as a passwordless admin', async () => {
  process.env.AUTH_ADMIN_EMAIL = '  Owner@Example.com ';
  assert.deepEqual(await bootstrapFirstAdmin(), { created: true });
  const [row] = db.__tables.users;
  assert.equal(db.__tables.users.length, 1);
  assert.equal(row.email, ADMIN);
  assert.equal(row.role, 'admin');
  assert.equal(row.organization_id, ORG);
  assert.equal(row.password_hash ?? null, null);
});

test('any existing user means the bootstrap writes nothing', async () => {
  db.__tables.users.push({
    id: 'someone',
    organization_id: ORG,
    email: 'someone@example.com',
    role: 'user',
    auth_source: 'database',
  });
  const before = structuredClone(db.__tables.users);
  assert.deepEqual(await bootstrapFirstAdmin(), {
    created: false,
    reason: 'not_empty',
  });
  assert.deepEqual(db.__tables.users, before);
});

test('a second boot is a no-op', async () => {
  await bootstrapFirstAdmin();
  assert.equal((await bootstrapFirstAdmin()).created, false);
  assert.equal(db.__tables.users.length, 1);
});

for (const [label, env, reason] of [
  ['auth off', { AUTH_ENABLED: 'false' }, 'auth_disabled'],
  ['no admin address', { AUTH_ADMIN_EMAIL: '' }, 'no_admin_email'],
  ['an invalid address', { AUTH_ADMIN_EMAIL: 'not-an-address' }, 'invalid'],
  ['a dotless host', { AUTH_ADMIN_EMAIL: 'admin@localhost' }, 'invalid'],
]) {
  test(`${label}: no user is created`, async () => {
    Object.assign(process.env, env);
    assert.deepEqual(await bootstrapFirstAdmin(), { created: false, reason });
    assert.equal(db.__tables.users.length, 0);
  });
}

test('without SSO the first admin signs in through a magic link', async () => {
  await bootstrapFirstAdmin();
  const requested = await post('/api/auth/magic-link', { email: ADMIN });
  assert.equal(requested.statusCode, 200);
  assert.equal(mails.length, 1, 'the link is mailed to the bootstrap address');
  assert.equal(mails[0].to[0].email, ADMIN);
  const token = /token=([A-Za-z0-9_-]+)/.exec(mails[0].htmlContent)?.[1];
  assert.ok(token, 'the mail carries the token');

  const verified = await post('/api/auth/magic-link/verify', { token });
  assert.equal(verified.statusCode, 200);
  assert.ok(verified.headers['Set-Cookie'], 'a session is set up');
  assert.equal(verified.json().user.email, ADMIN);
  assert.equal(verified.json().user.role, 'admin');
});

test('under SSO_ENFORCE magic link is refused and the IdP login claims the row', async () => {
  Object.assign(process.env, SSO);
  await bootstrapFirstAdmin();
  const refused = await post('/api/auth/magic-link', { email: ADMIN });
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(mails, []);

  const sso = await getOrCreateSsoUser(
    createStorageScope(null),
    { email: ADMIN, name: 'Owner' },
    { autoProvision: false, defaultRole: 'user' },
  );
  assert.equal(sso.ok, true);
  assert.equal(sso.provisioned, false, 'the bootstrap row, not a new one');
  assert.equal(db.__tables.users.length, 1);
  assert.equal(db.__tables.users[0].role, 'admin');
});
