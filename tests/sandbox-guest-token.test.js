/**
 * The sandbox guest's cookie is a signed credential (B501).
 *
 * The sandbox is public and has no login, so `sb_sandbox` is the only thing
 * that says who a guest is. It is signed with AUTH_SECRET in the one signed
 * form (server/utils/signed-payload.js), carries its own expiry, and stays out
 * of reach of page scripts: HttpOnly, and nothing in `/api/auth/me` repeats it.
 * A guest also cannot turn its throwaway session into a persistent API key,
 * while an ordinary user's path is unchanged.
 *
 * Runs against the in-memory Kysely double; the row and ownership seam is in
 * tests/pg/sandbox-guest-identity.pgtest.js.
 *
 * Run with: node --test tests/sandbox-guest-token.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createFakeDb } from './helpers/fake-db.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { __setTestDb } from '../server/db/client.js';
import { ensureSandboxUser } from '../server/auth/sandbox.js';
import { authEnabled } from '../server/auth/auth.js';
import { signPayload } from '../server/utils/signed-payload.js';
import { handleApiKeys } from '../server/routes/api/api-keys.js';
import { listApiKeys } from '../server/storage/api-keys.js';
import { handleAuth } from '../server/routes/api/auth.js';

const SECRET = 'sandbox-guest-token-test-secret-at-least-32';
const ORG = '00000000-0000-4000-8000-00000000000a';
const DAY = 24 * 60 * 60 * 1000;

const saved = {};
const KEYS = [
  'SANDBOX_MODE',
  'AUTH_SECRET',
  'SANDBOX_COOKIE_DAYS',
  'SECURE_COOKIES',
];

test.beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.SANDBOX_MODE = '1';
  process.env.AUTH_SECRET = SECRET;
  delete process.env.SANDBOX_COOKIE_DAYS;
  delete process.env.SECURE_COOKIES;
});

test.afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  __setTestDb(null);
});

const reqWith = (token) => ({
  headers: token ? { cookie: `sb_sandbox=${token}` } : {},
});

/** Mint a guest; returns the guest, its token and the raw Set-Cookie. */
function mint() {
  const res = createMockRes();
  const guest = ensureSandboxUser(reqWith(null), res);
  const setCookie = String(res.headers['Set-Cookie']);
  const token = /sb_sandbox=([^;]+)/.exec(setCookie)[1];
  return { guest, token, setCookie };
}

/** Whether a request with this token was given a new cookie (a new guest). */
function resolve(token) {
  const res = createMockRes();
  const guest = ensureSandboxUser(reqWith(token), res);
  return { guest, minted: !!res.headers['Set-Cookie'] };
}

const payloadOf = (token) =>
  JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());

test('a valid token resolves to the same guest, with no new cookie', () => {
  const { guest, token } = mint();
  const back = resolve(token);
  assert.equal(back.minted, false);
  assert.equal(back.guest.email, guest.email);
  assert.match(guest.email, /^guest-[0-9a-f]{32}@sandbox\.local$/);
  assert.equal(back.guest.isSandboxGuest, true);
});

test('two guests stay two identities', () => {
  assert.notEqual(mint().guest.email, mint().guest.email);
});

test('a token nobody signed is a new guest, also the old bare-UUID form', () => {
  for (const bad of [
    '3f2b1c4d-0000-4000-8000-000000000000',
    'x.y',
    'a.b.c',
    '',
  ]) {
    const { guest, minted } = resolve(bad);
    assert.equal(minted, true, `"${bad}" must mint`);
    assert.ok(guest.isSandboxGuest);
  }
});

test('an altered token cannot reach the guest it now names', () => {
  const victim = mint();
  const attacker = mint();
  // The victim's payload under the attacker's signature, and the reverse.
  const [victimBody, victimSig] = victim.token.split('.');
  const [attackerBody, attackerSig] = attacker.token.split('.');
  for (const forged of [
    `${victimBody}.${attackerSig}`,
    `${attackerBody}.${victimSig}`,
  ]) {
    const { guest, minted } = resolve(forged);
    assert.equal(minted, true);
    assert.notEqual(guest.email, victim.guest.email);
    assert.notEqual(guest.email, attacker.guest.email);
  }
});

test('a token signed with another secret is refused', () => {
  const { guest, token } = mint();
  process.env.AUTH_SECRET = 'a-different-secret-of-at-least-32-characters';
  const after = resolve(token);
  assert.equal(after.minted, true);
  assert.notEqual(after.guest.email, guest.email);
});

test('an expired token is refused, even correctly signed', () => {
  const sid = '3f2b1c4d-0000-4000-8000-000000000000';
  const valid = signPayload(
    { purpose: 'sandbox_guest', sid, exp: Date.now() + DAY },
    SECRET,
  );
  const expired = signPayload(
    { purpose: 'sandbox_guest', sid, exp: Date.now() - 1000 },
    SECRET,
  );
  const live = resolve(valid);
  assert.equal(live.minted, false);
  const dead = resolve(expired);
  assert.equal(dead.minted, true);
  assert.notEqual(dead.guest.email, live.guest.email);
});

test('a token AUTH_SECRET signed for something else is not a guest', () => {
  const exp = Date.now() + DAY;
  for (const payload of [
    { sid: 'no-purpose', exp },
    { purpose: 'share_grant', sid: 'wrong-purpose', exp },
    { purpose: 'sandbox_guest', exp },
    { purpose: 'sandbox_guest', sid: 42, exp },
    { email: 'admin@example.test', v: '1', exp },
  ]) {
    assert.equal(
      resolve(signPayload(payload, SECRET)).minted,
      true,
      JSON.stringify(payload),
    );
  }
});

test('the cookie is HttpOnly, keeps its attributes and its lifetime', () => {
  const before = Date.now();
  const { token, setCookie } = mint();
  const attrs = setCookie.split('; ').slice(1);
  assert.ok(attrs.includes('HttpOnly'), setCookie);
  assert.ok(attrs.includes('SameSite=Lax'), setCookie);
  assert.ok(attrs.includes('Path=/'), setCookie);
  assert.ok(attrs.includes(`Max-Age=${30 * 24 * 60 * 60}`), setCookie);
  assert.ok(!attrs.includes('Secure'), setCookie);
  // The server's expiry is the cookie's: a stolen token dies with it.
  const { exp } = payloadOf(token);
  assert.ok(exp >= before + 30 * DAY && exp <= Date.now() + 30 * DAY);
});

test('SANDBOX_COOKIE_DAYS sets both lifetimes; secure cookies add Secure', () => {
  process.env.SANDBOX_COOKIE_DAYS = '2';
  process.env.SECURE_COOKIES = '1';
  const { token, setCookie } = mint();
  const attrs = setCookie.split('; ');
  assert.ok(attrs.includes('Secure'), setCookie);
  assert.ok(attrs.includes(`Max-Age=${2 * 24 * 60 * 60}`), setCookie);
  assert.ok(payloadOf(token).exp <= Date.now() + 2 * DAY);
});

test('minting fails closed without a secret', () => {
  delete process.env.AUTH_SECRET;
  assert.throws(() => mint(), /AUTH_SECRET is required/);
});

test('a secret in sandbox mode opens no login route', () => {
  assert.equal(authEnabled(), false);
});

test('/api/auth/me repeats no part of the credential', async () => {
  __setTestDb(createFakeDb({}));
  const { token } = mint();
  const res = createMockRes();
  const handled = await handleAuth({
    repoRoot: null,
    req: createMockReq({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `sb_sandbox=${token}` },
    }),
    res,
    url: new URL('http://x/api/auth/me'),
  });
  assert.equal(handled, true);
  const body = String(res.body);
  assert.equal(JSON.parse(body).user.isSandboxGuest, true);
  const { sid } = payloadOf(token);
  for (const secretPart of [token, sid, token.split('.')[1]]) {
    assert.ok(!body.includes(secretPart), `leaked ${secretPart}`);
  }
});

function keyCtx(user) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/api-keys',
    body: { name: 'CI bot', permissions: ['read'] },
  });
  return {
    storageScope: {
      repoRoot: null,
      organizationId: ORG,
      actorEmail: user.email,
    },
    req,
    res: createMockRes(),
    url: new URL('http://x/api/api-keys'),
    authedUser: user,
  };
}

test('a sandbox guest cannot create an API key', async () => {
  __setTestDb(createFakeDb({}));
  const { guest } = mint();
  const ctx = keyCtx({ ...guest, id: 'guest-1' });
  assert.equal(await handleApiKeys(ctx), true);
  assert.equal(ctx.res.statusCode, 403);
  assert.equal(JSON.parse(ctx.res.body).error, 'forbidden');
  const { keys } = await listApiKeys(ctx.storageScope, {});
  assert.deepEqual(keys, [], 'no key was written');
});

test('an ordinary user still creates one', async () => {
  delete process.env.SANDBOX_MODE;
  __setTestDb(createFakeDb({}));
  const ctx = keyCtx({ id: 'u1', email: 'owner@example.test', role: 'user' });
  assert.equal(await handleApiKeys(ctx), true);
  assert.equal(ctx.res.statusCode, 201);
  assert.ok(JSON.parse(ctx.res.body).key);
  const { keys } = await listApiKeys(ctx.storageScope, {});
  assert.equal(keys.length, 1);
});

test('the sandbox compose file will not start without the secret', () => {
  const compose = readFileSync(
    new URL('../docker-compose.sandbox.yml', import.meta.url),
    'utf8',
  );
  assert.match(compose, /AUTH_SECRET: '\$\{AUTH_SECRET:\?/);
});
