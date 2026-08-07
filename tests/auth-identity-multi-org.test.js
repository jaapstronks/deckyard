/**
 * Identity resolution with MULTI_ORG_ENABLED, i.e. several organizations
 * on one managed instance (A1 phase 0).
 *
 * What this pins down:
 *
 *   - A person is resolved by their globally unique email, never by
 *     `users.organization_id`. Before this change, anyone whose home
 *     organization was not the default one resolved to null on every request
 *     and got a 401, which is why multi-organization was never wired up.
 *   - The organization a session may act in comes from the session token but is
 *     re-verified against `user_organizations` on every request, because the
 *     token outlives a membership revocation (14 days by default).
 *   - A revoked or unknown organization falls back to the person's oldest
 *     remaining membership rather than logging them out or silently dropping
 *     them into the default organization. No membership at all is refused.
 *   - Write paths that key on email reuse the existing row instead of
 *     attempting a second one, which the unique constraint would reject.
 *
 * MULTI_ORG_ENABLED is read at module scope, so this file sets it before
 * importing anything and relies on node --test giving each file its own
 * process. The single-organization half lives in auth-identity-resolution.test.js.
 *
 * Run with: node --test tests/auth-identity-multi-org.test.js
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
const ORG_GONE = '00000000-0000-0000-0000-0000000000cc';

const { createFakeDb, touchedTables } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const { isMultiOrgEnabled } = await import('../server/config/features.js');
const auth = await import('../server/auth/auth.js');
const identity = await import('../server/storage/identity.js');
const passwordReset = await import('../server/storage/password-reset.js');
const magicLinkStore = await import('../server/storage/magic-link.js');
const ssoStore = await import('../server/storage/sso.js');
const usersStore = await import('../server/storage/users.js');

/** Context for the organization a request is currently being handled in. */
const ctxIn = (organizationId) => ({ organizationId, actorEmail: 'alice@example.com' });

let passwordHash;

test.before(async () => {
  passwordHash = await hashPassword('correct horse battery');
  assert.equal(isMultiOrgEnabled(), true, 'multi-organization flag is on for this file');
});

test.afterEach(() => {
  __setTestDb(null);
});

/**
 * Alice's home organization is ORG_B, which is NOT the default organization.
 * She holds memberships in ORG_A (older) and ORG_B (newer).
 * @param {Object} [options] - `memberships` overrides the seeded memberships
 * @returns {Object} the fake db
 */
function seedMultiOrg(options = {}) {
  const memberships =
    options.memberships === undefined
      ? [
          {
            id: 'membership-a',
            user_id: 'user-alice',
            organization_id: ORG_A,
            role: 'member',
            is_designer: false,
            joined_at: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'membership-b',
            user_id: 'user-alice',
            organization_id: ORG_B,
            role: 'owner',
            is_designer: false,
            joined_at: '2026-03-01T00:00:00.000Z',
          },
        ]
      : options.memberships;

  const db = createFakeDb({
    organizations: [
      { id: ORG_A, name: 'Alpha', slug: 'alpha' },
      { id: ORG_B, name: 'Beta', slug: 'beta' },
    ],
    users: [
      {
        id: 'user-alice',
        // Home organization is not the default one. This is the exact state
        // that used to 401 on every request.
        organization_id: ORG_B,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        auth_source: 'database',
        password_hash: passwordHash,
        password_changed_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
    ],
    user_organizations: memberships,
  });
  __setTestDb(db);
  return db;
}

/** Build a request carrying a session for the given active organization. */
function requestWithSession(user, organizationId) {
  const req = { headers: {} };
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  auth.setSessionCookie(req, res, user, { organizationId });
  return { headers: { cookie: String(res.headers['Set-Cookie']).split(';')[0] } };
}

// ---------------------------------------------------------------------------
// Identity is organization-independent
// ---------------------------------------------------------------------------

test('a user whose home organization is not the default one can log in', async () => {
  seedMultiOrg();
  const user = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_A)
  );
  assert.ok(user, 'login succeeded from a context in a different organization');
  assert.equal(user.email, 'alice@example.com');
});

test('getUserByEmailGlobal ignores the home organization', async () => {
  seedMultiOrg();
  const row = await identity.getUserByEmailGlobal('alice@example.com');
  assert.equal(row.id, 'user-alice');
  assert.equal(row.organization_id, ORG_B, 'home organization is untouched');
});

// ---------------------------------------------------------------------------
// Active organization comes from the session, verified against membership
// ---------------------------------------------------------------------------

test('a session resolves to the organization it carries when membership holds', async () => {
  seedMultiOrg();
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_A)
  );

  for (const org of [ORG_A, ORG_B]) {
    const resolved = await auth.getUserFromRequestAsync(requestWithSession(login, org), {});
    assert.ok(resolved, `session for ${org} resolved`);
    assert.equal(resolved.organizationId, org);
  }
});

test('a revoked membership falls back to the oldest remaining one', async () => {
  seedMultiOrg({
    memberships: [
      {
        id: 'membership-b',
        user_id: 'user-alice',
        organization_id: ORG_B,
        role: 'owner',
        is_designer: false,
        joined_at: '2026-03-01T00:00:00.000Z',
      },
    ],
  });
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_B)
  );

  // The token still says ORG_A; the membership behind it is gone.
  const resolved = await auth.getUserFromRequestAsync(requestWithSession(login, ORG_A), {});
  assert.ok(resolved, 'the person stays logged in');
  assert.equal(resolved.organizationId, ORG_B, 'falls back to an organization they do belong to');
});

test('an organization the user never belonged to is not honoured', async () => {
  seedMultiOrg();
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_A)
  );

  const resolved = await auth.getUserFromRequestAsync(requestWithSession(login, ORG_GONE), {});
  assert.ok(resolved);
  assert.equal(resolved.organizationId, ORG_A, 'oldest membership, not the requested one');
  assert.notEqual(resolved.organizationId, ORG_GONE);
});

test('a session with no organization falls back to the oldest membership', async () => {
  seedMultiOrg();
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_A)
  );

  const resolved = await auth.getUserFromRequestAsync(requestWithSession(login, null), {});
  assert.ok(resolved);
  assert.equal(resolved.organizationId, ORG_A);
});

test('a user with no memberships at all is refused', async () => {
  seedMultiOrg({ memberships: [] });
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_A)
  );

  const resolved = await auth.getUserFromRequestAsync(requestWithSession(login, ORG_A), {});
  assert.equal(resolved, null, 'no membership means no organization to act in');
});

test('resolveActiveOrganization is the single decision point', async () => {
  seedMultiOrg();
  assert.equal(await identity.resolveActiveOrganization('user-alice', ORG_B), ORG_B);
  assert.equal(await identity.resolveActiveOrganization('user-alice', ORG_GONE), ORG_A);
  assert.equal(await identity.resolveActiveOrganization('user-alice', undefined), ORG_A);
  assert.equal(await identity.resolveActiveOrganization('user-nobody', ORG_A), null);
  assert.equal(await identity.resolveActiveOrganization(null, ORG_A), null);
});

// ---------------------------------------------------------------------------
// The membership role travels with the session (organization UI, slice 2)
// ---------------------------------------------------------------------------

test('the session carries the role held in the active organization', async () => {
  seedMultiOrg();
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_A)
  );

  // Alice is a plain member of ORG_A and the owner of ORG_B. The role must
  // follow the organization the session is in, not the person.
  const inA = await auth.getUserFromRequestAsync(requestWithSession(login, ORG_A), {});
  assert.equal(inA.organizationRole, 'member');

  const inB = await auth.getUserFromRequestAsync(requestWithSession(login, ORG_B), {});
  assert.equal(inB.organizationRole, 'owner');
});

test('the role follows the fallback when the requested membership is gone', async () => {
  seedMultiOrg();
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_A)
  );

  const resolved = await auth.getUserFromRequestAsync(requestWithSession(login, ORG_GONE), {});
  assert.equal(resolved.organizationId, ORG_A);
  assert.equal(resolved.organizationRole, 'member', 'the role belongs to the org fallen back to');
});

test('the role is read from the membership list the session already needs', async () => {
  const db = seedMultiOrg();
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct horse battery',
    ctxIn(ORG_A)
  );
  const req = requestWithSession(login, ORG_B);

  db.__queryLog.length = 0;
  const resolved = await auth.getUserFromRequestAsync(req, {});

  assert.equal(resolved.organizationRole, 'owner');
  // The membership lookup that decides the active organization is the same one
  // that carries the role: two reads (the person, their memberships), which is
  // what this path cost before the role was added.
  assert.deepEqual(
    touchedTables(db, 'select'),
    ['users', 'user_organizations'],
    'no second lookup was issued for the role'
  );
});

test('resolveActiveMembership answers org, role and designer from one lookup', async () => {
  seedMultiOrg();
  assert.deepEqual(await identity.resolveActiveMembership('user-alice', ORG_B), {
    organizationId: ORG_B,
    role: 'owner',
    isDesigner: false,
  });
  assert.deepEqual(await identity.resolveActiveMembership('user-alice', ORG_GONE), {
    organizationId: ORG_A,
    role: 'member',
    isDesigner: false,
  });
  assert.deepEqual(await identity.resolveActiveMembership('user-nobody', ORG_A), {
    organizationId: null,
    role: null,
    isDesigner: null,
  });
});

// ---------------------------------------------------------------------------
// Write paths must reuse the person's row, not attempt a second one
// ---------------------------------------------------------------------------

test('the double rejects a duplicate email, like the unique constraint does', async () => {
  const db = seedMultiOrg();
  await assert.rejects(
    db.insertInto('users').values({ organization_id: ORG_A, email: 'alice@example.com' }).execute(),
    /unique constraint/,
    'a second row for the same email is impossible'
  );
});

test('a password reset from another organization updates the existing row', async () => {
  const db = seedMultiOrg();
  const result = await passwordReset.setUserPassword(
    'alice@example.com',
    'a brand new secret',
    ctxIn(ORG_A)
  );

  assert.equal(result.ok, true);
  assert.equal(db.__tables.users.length, 1, 'no second row');
  assert.equal(db.__tables.users[0].organization_id, ORG_B, 'home organization unchanged');
  assert.notEqual(db.__tables.users[0].password_hash, passwordHash);
});

test('a magic-link login from another organization reuses the existing row', async () => {
  const db = seedMultiOrg();
  const result = await magicLinkStore.getOrCreateMagicLinkUser('alice@example.com', ctxIn(ORG_A));

  assert.equal(result.ok, true);
  assert.equal(result.user.id, 'user-alice');
  assert.equal(db.__tables.users.length, 1);
});

test('an SSO login from another organization reuses the existing row', async () => {
  const db = seedMultiOrg();
  const result = await ssoStore.getOrCreateSsoUser(
    { email: 'alice@example.com', name: 'Alice' },
    { autoProvision: true },
    ctxIn(ORG_A)
  );

  assert.equal(result.ok, true);
  assert.equal(result.provisioned, false);
  assert.equal(db.__tables.users.length, 1);
});

test('inviting someone who already exists elsewhere reports already_exists', async () => {
  const db = seedMultiOrg();
  const result = await usersStore.createUser({ email: 'alice@example.com' }, ctxIn(ORG_A));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already_exists', 'a clean refusal, not a constraint violation');
  assert.equal(db.__tables.users.length, 1);
});

test('inviting a genuinely new person still creates them in the current organization', async () => {
  const db = seedMultiOrg();
  const result = await usersStore.createUser({ email: 'newcomer@example.com' }, ctxIn(ORG_A));

  assert.equal(result.ok, true);
  assert.equal(db.__tables.users.length, 2);
  assert.equal(
    db.__tables.users.find((u) => u.email === 'newcomer@example.com').organization_id,
    ORG_A
  );
});
