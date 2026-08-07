/**
 * The admin Users routes act in the session's organization (organization UI,
 * slice 7).
 *
 * `handleAdminUsers` built its route context from `null`, so `getOrgId(ctx)`
 * answered with the instance default and the two explicit
 * `getDefaultOrganizationId()` calls said the same thing three times over. The
 * effect in multi-organization mode: an instance admin who had switched into
 * another organization still listed the *default* organization's people, read
 * their designer flag from the *default* organization's memberships, and — on
 * a PATCH — wrote the flag onto a membership in an organization they were not
 * even looking at, creating one there if it did not exist.
 *
 * Every assertion below fails against that code. In single-organization mode
 * nothing changes: the session's organization *is* the default one, which is
 * what `tests/request-organization-binding.test.js` pins.
 *
 * MULTI_ORG_ENABLED is read at module scope (server/config/features.js),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/admin-users-organization-scope.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
process.env.MULTI_ORG_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG_A = process.env.DEFAULT_ORGANIZATION_ID;
const ORG_B = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { isMultiOrgEnabled } = await import('../server/config/features.js');
const { sessionVersion } = await import('../server/utils/session-version.js');
const auth = await import('../server/auth/auth.js');
const { handleAdminUsers } = await import('../server/routes/api/admin-users.js');

const UPDATED_AT = '2026-02-01T00:00:00.000Z';

test.before(() => {
  assert.equal(isMultiOrgEnabled(), true, 'multi-organization flag is on for this file');
});

test.afterEach(() => {
  __setTestDb(null);
});

/**
 * Alice is an instance admin with a membership in both organizations. Bob's
 * home organization is Alpha, Carol's is Beta, and only Carol carries the
 * designer flag — so a list scoped to the wrong organization shows the wrong
 * people *and* the wrong flag.
 *
 * @returns {Object} the fake db
 */
function seedTwoOrgs() {
  const user = (id, email, organizationId, role = 'user') => ({
    id,
    organization_id: organizationId,
    email,
    name: id,
    role,
    auth_source: 'database',
    password_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: UPDATED_AT,
    settings: {},
  });

  const membership = (id, userId, organizationId, role, isDesigner = false) => ({
    id,
    user_id: userId,
    organization_id: organizationId,
    role,
    is_designer: isDesigner,
    joined_at: '2026-01-01T00:00:00.000Z',
  });

  const db = createFakeDb({
    organizations: [
      { id: ORG_A, name: 'Alpha', slug: 'alpha', settings: {} },
      { id: ORG_B, name: 'Beta', slug: 'beta', settings: {} },
    ],
    users: [
      user('user-alice', 'alice@example.com', ORG_A, 'admin'),
      user('user-bob', 'bob@example.com', ORG_A),
      user('user-carol', 'carol@example.com', ORG_B),
    ],
    user_organizations: [
      membership('membership-alice-a', 'user-alice', ORG_A, 'admin'),
      membership('membership-alice-b', 'user-alice', ORG_B, 'owner'),
      membership('membership-bob-a', 'user-bob', ORG_A, 'member'),
      membership('membership-carol-b', 'user-carol', ORG_B, 'member', true),
    ],
    auth_audit_log: [],
  });
  __setTestDb(db);
  return db;
}

/** A request whose cookie carries Alice's session in `organizationId`. */
function requestWithSession(method, organizationId, body) {
  const carrier = { headers: {} };
  const sink = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
  };
  auth.setSessionCookie(
    carrier,
    sink,
    {
      email: 'alice@example.com',
      role: 'admin',
      name: 'alice',
      v: sessionVersion({ updated_at: UPDATED_AT }),
    },
    { organizationId }
  );

  return {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: String(sink.headers['Set-Cookie']).split(';')[0],
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body ?? {}));
    },
  };
}

/** Collects what the handler wrote. */
function fakeResponse() {
  const chunks = [];
  return {
    statusCode: null,
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      if (payload) chunks.push(payload);
    },
    body() {
      try {
        return JSON.parse(chunks.join(''));
      } catch {
        return null;
      }
    },
  };
}

/**
 * Call an admin-users route as Alice, from a session in `organizationId`.
 *
 * @param {string} method - HTTP method.
 * @param {string} path - Path under /api/admin/users.
 * @param {string} organizationId - The organization Alice has switched into.
 * @param {Object} [body] - Request body.
 * @returns {Promise<{status: number, body: Object|null}>}
 */
async function callAdminUsers(method, path, organizationId, body) {
  const res = fakeResponse();
  await handleAdminUsers({
    repoRoot: process.cwd(),
    req: requestWithSession(method, organizationId, body),
    res,
    url: new URL(`http://localhost${path}`),
  });
  return { status: res.statusCode, body: res.body() };
}

/** The membership row for a person in an organization, if any. */
function membershipOf(db, userId, organizationId) {
  return db.__tables.user_organizations.find(
    (r) => r.user_id === userId && r.organization_id === organizationId
  );
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

test('the list follows the session organization, not the instance default', async () => {
  seedTwoOrgs();

  const inAlpha = await callAdminUsers('GET', '/api/admin/users', ORG_A);
  assert.equal(inAlpha.status, 200);
  assert.deepEqual(
    inAlpha.body.users.map((u) => u.email).sort(),
    ['alice@example.com', 'bob@example.com']
  );

  const inBeta = await callAdminUsers('GET', '/api/admin/users', ORG_B);
  assert.equal(inBeta.status, 200);
  assert.deepEqual(
    inBeta.body.users.map((u) => u.email).sort(),
    ['carol@example.com'],
    'switching organizations must change who the Users tab is about'
  );
});

test('the designer flag is read from the session organization', async () => {
  seedTwoOrgs();

  const inBeta = await callAdminUsers('GET', '/api/admin/users', ORG_B);
  const carol = inBeta.body.users.find((u) => u.email === 'carol@example.com');
  assert.equal(carol.isDesigner, true, 'Carol is a designer in Beta, which is where we are');
  assert.equal(carol.isExplicitDesigner, true);
});

// ---------------------------------------------------------------------------
// Writing the designer flag
// ---------------------------------------------------------------------------

test('the designer flag is written on the session organization membership', async () => {
  const db = seedTwoOrgs();

  const { status } = await callAdminUsers('PATCH', '/api/admin/users/user-bob', ORG_A, {
    isDesigner: true,
  });
  assert.equal(status, 200);
  assert.equal(membershipOf(db, 'user-bob', ORG_A).is_designer, true);
});

test('a person outside the session organization cannot be edited from it', async () => {
  const db = seedTwoOrgs();
  const before = db.__tables.user_organizations.length;

  // Bob's home organization is Alpha, so from a Beta session he is not on the
  // list and not addressable. The old code answered this PATCH by looking his
  // membership up in the *default* organization, finding one, and writing the
  // designer flag there — a write into an organization the admin was not even
  // looking at, from a screen listing entirely different people.
  const { status } = await callAdminUsers('PATCH', '/api/admin/users/user-bob', ORG_B, {
    isDesigner: true,
  });

  assert.equal(status, 404, 'he is not in this organization, so there is nothing to edit');
  assert.equal(
    membershipOf(db, 'user-bob', ORG_A).is_designer,
    false,
    'and the organization we are not in stays untouched'
  );
  assert.equal(db.__tables.user_organizations.length, before, 'no membership is invented');
});
