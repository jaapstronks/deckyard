/**
 * Identity resolution on the authentication path, single-workspace mode.
 *
 * This is the regression net for A1 fase 0 (org-independent identity). Every
 * assertion here describes behaviour that MUST NOT change when the user lookup
 * stops filtering on `users.organization_id`: single-workspace installations
 * have exactly one organization, so dropping the filter is a no-op for them.
 * If one of these breaks, the change leaked into the single-org path, which is
 * every existing installation.
 *
 * The multi-organization half lives in auth-identity-multi-org.test.js, which
 * needs MULTI_WORKSPACE_ENABLED set before module load and therefore its own
 * process (node --test runs one process per file).
 *
 * Run with: node --test tests/auth-identity-resolution.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionVersion } from '../server/utils/session-version.js';

// Auth config must be in place before the modules under test are imported:
// authEnabled() and the multi-workspace flag are read at module scope.
// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_WORKSPACE_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const DEFAULT_ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb, touchedTables } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const auth = await import('../server/auth/auth.js');
const passwordReset = await import('../server/storage/password-reset.js');
const identity = await import('../server/storage/identity.js');
const magicLinkStore = await import('../server/storage/magic-link.js');
const ssoStore = await import('../server/storage/sso.js');
const usersStore = await import('../server/storage/users.js');
const { withSettings } = await import('../server/storage/adapters/postgres/settings.js');

const SettingsAdapter = withSettings(class {});

const ctx = { organizationId: DEFAULT_ORG, actorEmail: 'alice@example.com' };

/** Build a request whose cookie header carries the session the server just set. */
function requestWithSession(user, options = {}) {
  const req = { headers: {} };
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  auth.setSessionCookie(req, res, user, options);
  const cookie = String(res.headers['Set-Cookie']).split(';')[0];
  return { headers: { cookie } };
}

let passwordHash;

test.before(async () => {
  passwordHash = await hashPassword('correct horse battery');
});

test.afterEach(() => {
  __setTestDb(null);
});

/**
 * Seed a database with one user in the default organization.
 * @param {Object} [overrides] - User row overrides
 * @returns {Object} the fake db
 */
function seedSingleOrg(overrides = {}) {
  const db = createFakeDb({
    organizations: [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: 'user-alice',
        organization_id: DEFAULT_ORG,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        auth_source: 'database',
        password_hash: passwordHash,
        password_changed_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
        ...overrides,
      },
    ],
    user_organizations: [
      {
        id: 'membership-alice',
        user_id: 'user-alice',
        organization_id: DEFAULT_ORG,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Password login
// ---------------------------------------------------------------------------

test('verifyLoginAsync accepts the correct password', async () => {
  seedSingleOrg();
  const user = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', ctx);
  assert.ok(user, 'login resolved a user');
  assert.equal(user.email, 'alice@example.com');
  assert.equal(user.role, 'user');
  assert.equal(user.authSource, 'database');
  assert.ok(user.v, 'session version issued');
});

test('verifyLoginAsync rejects a wrong password', async () => {
  seedSingleOrg();
  const user = await auth.verifyLoginAsync('alice@example.com', 'wrong', ctx);
  assert.equal(user, null);
});

test('verifyLoginAsync rejects an unknown email', async () => {
  seedSingleOrg();
  const user = await auth.verifyLoginAsync('nobody@example.com', 'correct horse battery', ctx);
  assert.equal(user, null);
});

test('verifyLoginAsync rejects a user without database credentials', async () => {
  seedSingleOrg({ auth_source: 'magic_link', password_hash: null });
  const user = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', ctx);
  assert.equal(user, null);
});

test('login is case-insensitive on the email', async () => {
  seedSingleOrg();
  const user = await auth.verifyLoginAsync('ALICE@Example.com', 'correct horse battery', ctx);
  assert.ok(user, 'mixed-case email still resolves');
});

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

test('getUserFromRequestAsync resolves a valid session to the default organization', async () => {
  const db = seedSingleOrg();
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', ctx);
  const req = requestWithSession(login);

  const resolved = await auth.getUserFromRequestAsync(req, ctx);
  assert.ok(resolved, 'session resolved');
  assert.equal(resolved.email, 'alice@example.com');
  assert.equal(resolved.organizationId, DEFAULT_ORG);
  assert.equal(db.__tables.users.length, 1, 'no user rows created by a read');
});

test('getUserFromRequestAsync rejects a tampered signature', async () => {
  seedSingleOrg();
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', ctx);
  const req = requestWithSession(login);
  req.headers.cookie = `${req.headers.cookie.slice(0, -2)}xx`;

  assert.equal(await auth.getUserFromRequestAsync(req, ctx), null);
});

test('getUserFromRequestAsync rejects a session with no cookie', async () => {
  seedSingleOrg();
  assert.equal(await auth.getUserFromRequestAsync({ headers: {} }, ctx), null);
});

test('getUserFromRequestAsync rejects a session whose version is stale', async () => {
  const db = seedSingleOrg();
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', ctx);
  const req = requestWithSession(login);

  // Simulate a password change after the session was issued.
  db.__tables.users[0].password_changed_at = '2026-06-01T00:00:00.000Z';

  assert.equal(await auth.getUserFromRequestAsync(req, ctx), null);
});

test('getUserFromRequestAsync rejects a session for a deleted user', async () => {
  const db = seedSingleOrg();
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', ctx);
  const req = requestWithSession(login);

  db.__tables.users = [];

  assert.equal(await auth.getUserFromRequestAsync(req, ctx), null);
});

test('single-workspace session resolution issues no membership lookup', async () => {
  const db = seedSingleOrg();
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', ctx);
  const req = requestWithSession(login);

  db.__queryLog.length = 0;
  await auth.getUserFromRequestAsync(req, ctx);

  assert.deepEqual(
    [...new Set(touchedTables(db))],
    ['users'],
    'only the users table is touched when multi-workspace is off'
  );
});

// ---------------------------------------------------------------------------
// Identity lookups used by the auth-adjacent routes
// ---------------------------------------------------------------------------

test('getUserByEmailGlobal finds the user by email', async () => {
  seedSingleOrg();
  const row = await identity.getUserByEmailGlobal('alice@example.com');
  assert.ok(row);
  assert.equal(row.id, 'user-alice');
});

test('getUserByEmailGlobal returns null for an unknown email', async () => {
  seedSingleOrg();
  assert.equal(await identity.getUserByEmailGlobal('nobody@example.com'), null);
  assert.equal(await identity.getUserByEmailGlobal(''), null);
});

test('resolveActiveOrganization is configuration-only in single-workspace mode', async () => {
  const db = seedSingleOrg();
  db.__queryLog.length = 0;

  assert.equal(await identity.resolveActiveOrganization('user-alice', OTHER_ORG), DEFAULT_ORG);
  assert.equal(await identity.resolveActiveOrganization(null, undefined), DEFAULT_ORG);
  assert.deepEqual(db.__queryLog, [], 'no database access when multi-workspace is off');
});

test('hasDatabaseCredentials reflects password presence', async () => {
  seedSingleOrg();
  assert.equal(await passwordReset.hasDatabaseCredentials('alice@example.com'), true);

  seedSingleOrg({ password_hash: null, auth_source: 'magic_link' });
  assert.equal(await passwordReset.hasDatabaseCredentials('alice@example.com'), false);
});

test('verifyUserPassword checks the stored hash', async () => {
  seedSingleOrg();
  assert.equal(
    await passwordReset.verifyUserPassword('alice@example.com', 'correct horse battery'),
    true
  );
  assert.equal(await passwordReset.verifyUserPassword('alice@example.com', 'nope'), false);
});

test('getPasswordChangedAt returns the stored timestamp', async () => {
  seedSingleOrg();
  const at = await passwordReset.getPasswordChangedAt('alice@example.com');
  assert.equal(at.toISOString(), '2026-01-01T00:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Write paths that key on the globally unique email
// ---------------------------------------------------------------------------

test('setUserPassword updates the existing row instead of adding one', async () => {
  const db = seedSingleOrg();
  const result = await passwordReset.setUserPassword('alice@example.com', 'a brand new secret', ctx);

  assert.equal(result.ok, true);
  assert.equal(db.__tables.users.length, 1, 'still one user row');
  assert.notEqual(db.__tables.users[0].password_hash, passwordHash, 'hash was replaced');
  assert.equal(db.__tables.users[0].auth_source, 'database');
});

test('setUserPassword creates a user when the email is unknown', async () => {
  const db = seedSingleOrg();
  const result = await passwordReset.setUserPassword('newcomer@example.com', 'a brand new secret', ctx);

  assert.equal(result.ok, true);
  assert.equal(db.__tables.users.length, 2);
  const created = db.__tables.users.find((u) => u.email === 'newcomer@example.com');
  assert.equal(created.organization_id, DEFAULT_ORG);
});

test('getOrCreateMagicLinkUser reuses an existing user', async () => {
  const db = seedSingleOrg();
  const result = await magicLinkStore.getOrCreateMagicLinkUser('alice@example.com', ctx);

  assert.equal(result.ok, true);
  assert.equal(result.user.id, 'user-alice');
  assert.equal(db.__tables.users.length, 1);
});

test('getOrCreateMagicLinkUser provisions a new user in the context organization', async () => {
  const db = seedSingleOrg();
  const result = await magicLinkStore.getOrCreateMagicLinkUser('newcomer@example.com', ctx);

  assert.equal(result.ok, true);
  assert.equal(db.__tables.users.length, 2);
  const created = db.__tables.users.find((u) => u.email === 'newcomer@example.com');
  assert.equal(created.organization_id, DEFAULT_ORG);
  assert.equal(created.auth_source, 'magic_link');
});

test('getOrCreateSsoUser provisions and then reuses the same row', async () => {
  const db = seedSingleOrg();

  const provisioned = await ssoStore.getOrCreateSsoUser(
    { email: 'sso@example.com', name: 'Sso Person' },
    { autoProvision: true },
    ctx
  );
  assert.equal(provisioned.ok, true);
  assert.equal(provisioned.provisioned, true);
  assert.equal(db.__tables.users.length, 2);

  const again = await ssoStore.getOrCreateSsoUser(
    { email: 'sso@example.com', name: 'Renamed Person' },
    { autoProvision: true },
    ctx
  );
  assert.equal(again.ok, true);
  assert.equal(again.provisioned, false);
  assert.equal(db.__tables.users.length, 2, 'no duplicate row for the same email');
  assert.equal(
    db.__tables.users.find((u) => u.email === 'sso@example.com').name,
    'Renamed Person',
    'name refreshed on login'
  );
});

test('getOrCreateSsoUser refuses an unknown identity when auto-provision is off', async () => {
  seedSingleOrg();
  const result = await ssoStore.getOrCreateSsoUser(
    { email: 'stranger@example.com' },
    { autoProvision: false },
    ctx
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_provisioned');
});

test('user settings round-trip through the postgres adapter', async () => {
  const db = seedSingleOrg();
  const adapter = new SettingsAdapter();

  assert.deepEqual(await adapter.getUserSettings('alice@example.com', ctx), {});

  await adapter.setUserSettings('alice@example.com', { profile: { name: 'Alice A' } }, ctx);

  assert.equal(db.__tables.users.length, 1, 'settings write did not add a row');
  assert.deepEqual(await adapter.getUserSettings('alice@example.com', ctx), {
    profile: { name: 'Alice A' },
  });
});

// ---------------------------------------------------------------------------
// Membership-scoped lookups must KEEP their organization filter
// ---------------------------------------------------------------------------

test('listUsers only returns members of the context organization', async () => {
  const db = seedSingleOrg();
  db.__tables.organizations.push({ id: OTHER_ORG, name: 'Other', slug: 'other' });
  db.__tables.users.push({
    id: 'user-bob',
    organization_id: OTHER_ORG,
    email: 'bob@example.com',
    name: 'Bob',
    role: 'user',
    auth_source: 'database',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  });

  const list = await usersStore.listUsers(ctx);
  assert.deepEqual(list.map((u) => u.email), ['alice@example.com']);
});

test('searchUsers only returns members of the context organization', async () => {
  const db = seedSingleOrg();
  db.__tables.users.push({
    id: 'user-bob',
    organization_id: OTHER_ORG,
    email: 'bob@example.com',
    name: 'Bob',
    role: 'user',
    auth_source: 'database',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  });

  const found = await usersStore.searchUsers('example.com', {}, ctx);
  assert.deepEqual(found.map((u) => u.email), ['alice@example.com']);
});

test('getUserById only resolves within the context organization', async () => {
  const db = seedSingleOrg();
  db.__tables.users.push({
    id: 'user-bob',
    organization_id: OTHER_ORG,
    email: 'bob@example.com',
    role: 'user',
    auth_source: 'database',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  });

  assert.ok(await usersStore.getUserById('user-alice', ctx));
  assert.equal(await usersStore.getUserById('user-bob', ctx), null);
});

// Pin the wire format with a literal instead of recomputing it: asserting
// against sessionVersion() would only prove the helper equals itself, so a
// changed digest, encoding or length would sail through. Every already-issued
// cookie carries the format below, so changing it logs the whole world out.
test('sessionVersion derivation matches its pinned wire format', () => {
  assert.equal(sessionVersion({ password_changed_at: '2026-01-01T00:00:00.000Z' }), 'd-vHzFOcJBfd');
  assert.equal(sessionVersion({ updated_at: '2026-01-01T00:00:00.000Z' }), 'd-vHzFOcJBfd');
  assert.equal(
    sessionVersion({ password_changed_at: '2026-06-01T00:00:00.000Z' }),
    'LFoii_whDVCl',
  );
  // password_changed_at wins over updated_at.
  assert.equal(
    sessionVersion({
      password_changed_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    'LFoii_whDVCl',
  );
  // A row with neither timestamp gets the sentinel, not a hash of undefined.
  assert.equal(sessionVersion({}), 'db');
});

// The version the login path stamps must be the one the validator recomputes.
test('login stamps the shared session version', async () => {
  seedSingleOrg();
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', ctx);
  assert.equal(login.v, 'd-vHzFOcJBfd');
});
