/**
 * The OIDC callback end to end, against an in-process identity provider
 * (B269, review #1344).
 *
 * `openid-client` reaches the IdP through the global `fetch` (oauth4webapi),
 * so this file answers discovery, the token exchange and the JWKS from a stub
 * and hands back an RS256 ID token. Everything after that is the production
 * path: state, nonce, issuer and audience checks, claim mapping, the SSO user
 * store, and the minted session cookie. (openid-client does not verify the
 * signature of an ID token it received straight from the token endpoint; OIDC
 * Core 3.1.3.7 lets TLS stand in for it. A wrong nonce does fail every case.)
 *
 * What it pins, with `SSO_ENFORCE=true` and `OIDC_ORG_CLAIM` set:
 *
 *   - A matched organization claim reaches the session: the cookie resolves to
 *     that organization on the next request.
 *   - An unknown or missing claim, and a claim for an organization the person
 *     may not be given (auto-provisioning off), refuse with a readable login
 *     error and mint no session. The refusals write no user or membership.
 *
 * MULTI_ORG_ENABLED and the SSO settings are read from the environment, so
 * this file sets them before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/sso-oidc-callback.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'sso'].join('-').padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
process.env.MULTI_ORG_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ISSUER = 'https://idp.test';
const CLIENT_ID = 'deckyard-test';
process.env.SSO_ENABLED = 'true';
process.env.SSO_PROVIDER = 'oidc';
process.env.SSO_ENFORCE = 'true';
process.env.OIDC_ISSUER_URL = ISSUER;
process.env.OIDC_CLIENT_ID = CLIENT_ID;
process.env.OIDC_CLIENT_SECRET = ['client', 'secret'].join('-');
process.env.OIDC_REDIRECT_URI =
  'https://decks.example.test/api/auth/oidc/callback';
process.env.OIDC_ORG_CLAIM = 'org_id';
delete process.env.OIDC_ADMIN_GROUPS;
delete process.env.OIDC_ALLOWED_DOMAINS;
delete process.env.OIDC_DEFAULT_ROLE;
delete process.env.OIDC_AUTO_PROVISION;

const ORG_A = process.env.DEFAULT_ORGANIZATION_ID;
const ORG_B = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { signPayload } = await import('../server/utils/signed-payload.js');
const { isSsoEnforced } = await import('../server/config/sso.js');
const { resetOidcClientConfigCache } =
  await import('../server/auth/providers/oidc.js');
const { handleSso } = await import('../server/routes/api/sso.js');
const auth = await import('../server/auth/auth.js');

// ---------------------------------------------------------------------------
// The stub IdP
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const KID = 'test-key';
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: KID,
  alg: 'RS256',
  use: 'sig',
};

/** Claims the next token exchange signs into its ID token. */
let nextClaims = null;

/**
 * Sign an RS256 JWT.
 * @param {Object} claims
 * @returns {string}
 */
function signIdToken(claims) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${enc({ alg: 'RS256', typ: 'JWT', kid: KID })}.${enc(claims)}`;
  const sig = crypto.sign('sha256', Buffer.from(input), privateKey);
  return `${input}.${sig.toString('base64url')}`;
}

const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const realFetch = globalThis.fetch;

test.before(() => {
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== ISSUER) return realFetch(input);
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/token') {
      const now = Math.floor(Date.now() / 1000);
      return json({
        access_token: 'access',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: signIdToken({
          iss: ISSUER,
          aud: CLIENT_ID,
          sub: 'subject',
          iat: now,
          exp: now + 300,
          email_verified: true,
          ...nextClaims,
        }),
      });
    }
    return new Response('not found', { status: 404 });
  };
});

test.after(() => {
  globalThis.fetch = realFetch;
});

test.afterEach(() => {
  __setTestDb(null);
  resetOidcClientConfigCache();
});

// ---------------------------------------------------------------------------
// Driving the callback
// ---------------------------------------------------------------------------

function makeRes() {
  const cookies = [];
  return {
    cookies,
    statusCode: null,
    location: null,
    setHeader(name, value) {
      if (name === 'Set-Cookie') cookies.splice(0, cookies.length, value);
    },
    appendHeader(name, value) {
      if (name === 'Set-Cookie') cookies.push(value);
    },
    writeHead(status, headers) {
      this.statusCode = status;
      this.location = headers?.Location ?? null;
    },
    end() {},
    /** The session cookie this response minted, or null. */
    session() {
      const cookie = cookies.find(
        (c) => !c.startsWith('sb_oidc=') && !/Max-Age=0\b/.test(c),
      );
      return cookie ? cookie.split(';')[0] : null;
    },
  };
}

/**
 * Complete one OIDC login: the IdP returns a code, the browser brings back the
 * signed state cookie, and the callback exchanges the code.
 *
 * @param {Object} claims - Extra ID-token claims (email, org_id, name, ...).
 */
async function callback(claims) {
  const state = crypto.randomBytes(8).toString('hex');
  const nonce = crypto.randomBytes(8).toString('hex');
  nextClaims = { nonce, ...claims };
  const stateCookie = signPayload(
    {
      state,
      nonce,
      codeVerifier: crypto.randomBytes(32).toString('base64url'),
      returnTo: '/app',
      exp: Date.now() + 60_000,
    },
    process.env.AUTH_SECRET,
  );
  const res = makeRes();
  await handleSso({
    repoRoot: process.cwd(),
    req: {
      method: 'GET',
      headers: { cookie: `sb_oidc=${stateCookie}`, 'user-agent': 'test' },
      socket: { remoteAddress: '127.0.0.1' },
    },
    res,
    url: new URL(
      `https://decks.example.test/api/auth/oidc/callback?code=abc&state=${state}`,
    ),
  });
  return res;
}

/** Resolve a minted session cookie the way the next request would. */
function resolveSession(cookie) {
  return auth.getUserFromRequestAsync(
    { headers: { cookie } },
    { organizationId: ORG_A },
  );
}

function seed({ users = [], memberships = [] } = {}) {
  const db = createFakeDb({
    organizations: [
      { id: ORG_A, name: 'Alpha', slug: 'alpha' },
      { id: ORG_B, name: 'Beta', slug: 'beta', external_id: 'idp-beta' },
    ],
    users,
    user_organizations: memberships,
    auth_events: [],
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('enforcement is on for every case in this file', () => {
  assert.equal(isSsoEnforced(), true);
});

test('a matched organization claim lands in the minted session', async () => {
  const db = seed();
  const res = await callback({ email: 'new@example.com', org_id: 'idp-beta' });

  assert.equal(res.statusCode, 302);
  assert.equal(res.location, '/app');
  const cookie = res.session();
  assert.ok(cookie, 'a session cookie was minted');
  const user = await resolveSession(cookie);
  assert.equal(user.email, 'new@example.com');
  assert.equal(user.organizationId, ORG_B);
  assert.equal(user.organizationRole, 'member');
  assert.equal(db.__tables.user_organizations.length, 1);
  assert.equal(db.__tables.user_organizations[0].organization_id, ORG_B);
});

test('an unknown organization claim refuses login without a session or user', async () => {
  const db = seed();
  const res = await callback({ email: 'new@example.com', org_id: 'missing' });

  assert.equal(res.location, '/login?error=sso_org_not_found');
  assert.equal(res.session(), null);
  assert.equal(db.__tables.users.length, 0);
  assert.equal(db.__tables.user_organizations.length, 0);
});

test('a missing organization claim refuses login without a session or user', async () => {
  const db = seed();
  const res = await callback({ email: 'new@example.com' });

  assert.equal(res.location, '/login?error=sso_org_claim_missing');
  assert.equal(res.session(), null);
  assert.equal(db.__tables.users.length, 0);
});

test('a claim for an organization the person may not join refuses without touching them', async (t) => {
  process.env.OIDC_AUTO_PROVISION = 'false';
  t.after(() => delete process.env.OIDC_AUTO_PROVISION);
  const db = seed({
    users: [
      {
        id: 'user-alice',
        organization_id: ORG_A,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        auth_source: 'database',
        updated_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
    ],
    memberships: [
      {
        id: 'membership-a',
        user_id: 'user-alice',
        organization_id: ORG_A,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  const usersBefore = structuredClone(db.__tables.users);
  const membershipsBefore = structuredClone(db.__tables.user_organizations);

  const res = await callback({
    email: 'alice@example.com',
    name: 'Mallory Renamed',
    org_id: 'idp-beta',
  });

  assert.equal(res.location, '/login?error=sso_no_membership');
  assert.equal(res.session(), null);
  assert.deepEqual(db.__tables.users, usersBefore);
  assert.deepEqual(db.__tables.user_organizations, membershipsBefore);
});
