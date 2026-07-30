/**
 * Mutating the member list: who may do what to whom (organization UI, slice 4).
 *
 * Slice 3 put the members of the active organization in the Users tab and left
 * the rows read-only, because an affordance that 403s is worse than none. Slice
 * 4 gives them their actions, which means the refusals stop being theoretical:
 * the UI now draws a button for every rule this file pins, and hides one for
 * every rule it refuses.
 *
 * Three of these assertions fail against the code as slice 3 left it.
 *
 *   1. An organization **admin could demote the owner**. Both halves of the
 *      admin guard hinged on the *new* role, so `target: owner → member` walked
 *      through a branch whose own comment says "Admins cannot modify other
 *      admins or owners", and the organization was left ownerless. The target's
 *      current role is what decides whether an admin may touch the membership.
 *   2. `updateMemberRole()` had **no last-owner guard**, unlike `removeMember()`
 *      right next to it. Demotion was the second way to reach an organization
 *      with no owner, and nothing below the route stopped it.
 *   3. `listOrganizationMembers()` sorted with `ORDER BY role DESC`, which sorts
 *      the *strings* — alphabetically owner → member → admin, not the
 *      owner → admin → member its comment promised. Invisible while the list
 *      had one page and no actions; with paging it silently decides who lands
 *      on page two.
 *
 * Plus the organization-settings gate (briefing measurement 3): the admin keys
 * `adminsAreDesigners` and `rss` hung on the instance-wide `isAdmin`, so an
 * instance admin who had switched into an organization they are only a member
 * of could still write its settings. The rule is now the conjunction the UI
 * already applies through `isWorkspaceAdmin()`.
 *
 * MULTI_WORKSPACE_ENABLED is read at module scope (server/config/features.js),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/organization-member-mutations.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MULTI_WORKSPACE_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { isMultiWorkspaceEnabled } = await import('../server/config/features.js');
const { handleOrganizationMembers } = await import(
  '../server/routes/api/organization-members.js'
);
const { handleSettings } = await import('../server/routes/api/settings.js');
const {
  listOrganizationMembers,
  countOrganizationMembers,
  updateMemberRole,
} = await import('../server/storage/user-organizations/index.js');

test.before(() => {
  assert.equal(isMultiWorkspaceEnabled(), true, 'multi-workspace flag is on for this file');
});

/**
 * The cast: one owner, one admin, two plain members, all in ORG.
 * Emails are deliberately not in role order, so a test that passes only because
 * the rows happen to be sorted some other way is not available.
 */
const PEOPLE = [
  { key: 'owner', email: 'zoe@example.com', role: 'owner', joined: '2026-01-01T00:00:00.000Z' },
  { key: 'admin', email: 'adam@example.com', role: 'admin', joined: '2026-02-01T00:00:00.000Z' },
  { key: 'member', email: 'mia@example.com', role: 'member', joined: '2026-03-01T00:00:00.000Z' },
  { key: 'member2', email: 'ben@example.com', role: 'member', joined: '2026-04-01T00:00:00.000Z' },
];

/**
 * Seed the organization and install the double.
 * @param {Object} [options]
 * @param {Array<Object>} [options.people] - Cast override.
 * @param {Object} [options.settings] - Organization settings.
 * @returns {Object} The double.
 */
function seed({ people = PEOPLE, settings = {} } = {}) {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Beta', slug: 'beta', settings }],
    users: people.map((p) => ({
      id: `user-${p.key}`,
      organization_id: ORG,
      email: p.email,
      name: p.key,
      role: 'user',
      auth_source: 'database',
      created_at: '2026-01-01T00:00:00.000Z',
      settings: {},
    })),
    user_organizations: people.map((p) => ({
      id: `membership-${p.key}`,
      user_id: `user-${p.key}`,
      organization_id: ORG,
      role: p.role,
      is_designer: false,
      joined_at: p.joined,
    })),
  });
  __setTestDb(db);
  return db;
}

/** Minimal req/res pair for driving a route handler directly. */
function fakeExchange(method, body) {
  const chunks = [];
  const res = {
    statusCode: null,
    writeHead(status) {
      res.statusCode = status;
    },
    end(payload) {
      if (payload) chunks.push(payload);
    },
    body: () => {
      try {
        return JSON.parse(chunks.join(''));
      } catch {
        return null;
      }
    },
  };
  const req = {
    method,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body ?? {}));
    },
  };
  return { req, res };
}

/**
 * Call the members route as `actorKey`, on `targetKey` when given.
 *
 * @param {string} method - HTTP method.
 * @param {string} actorKey - Who is acting (a PEOPLE key).
 * @param {string|null} targetKey - Whose membership is the target.
 * @param {Object} [body] - Request body.
 * @returns {Promise<{status: number, body: Object|null}>}
 */
async function callMembers(method, actorKey, targetKey, body) {
  const actor = PEOPLE.find((p) => p.key === actorKey);
  const path = targetKey
    ? `/api/organizations/${ORG}/members/membership-${targetKey}`
    : `/api/organizations/${ORG}/members`;
  const { req, res } = fakeExchange(method, body);
  await handleOrganizationMembers({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://localhost${path}`),
    authedUser: {
      email: actor.email,
      isAdmin: false,
      organizationId: ORG,
      organizationRole: actor.role,
    },
  });
  return { status: res.statusCode, body: res.body() };
}

/** The stored role of one membership. */
function roleOf(db, key) {
  return db.__tables.user_organizations.find((r) => r.id === `membership-${key}`)?.role;
}

/** How many owners the organization has right now. */
function ownerCount(db) {
  return db.__tables.user_organizations.filter((r) => r.role === 'owner').length;
}

// ---------------------------------------------------------------------------
// The hole slice 4 walked into: an admin could demote the owner
// ---------------------------------------------------------------------------

test('an admin cannot demote the owner', async () => {
  const db = seed();
  const { status } = await callMembers('PATCH', 'admin', 'owner', { role: 'member' });

  assert.equal(status, 403, 'the guard the comment describes must actually refuse this');
  assert.equal(roleOf(db, 'owner'), 'owner');
  assert.equal(ownerCount(db), 1, 'the organization still has an owner');
});

test('an admin cannot demote another admin', async () => {
  const people = [...PEOPLE, {
    key: 'admin2', email: 'ada@example.com', role: 'admin', joined: '2026-02-15T00:00:00.000Z',
  }];
  const db = seed({ people });
  const { req, res } = fakeExchange('PATCH', { role: 'member' });
  await handleOrganizationMembers({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://localhost/api/organizations/${ORG}/members/membership-admin2`),
    authedUser: {
      email: 'adam@example.com',
      isAdmin: false,
      organizationId: ORG,
      organizationRole: 'admin',
    },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(roleOf(db, 'admin2'), 'admin');
});

test('an admin cannot promote a member', async () => {
  const db = seed();
  const { status } = await callMembers('PATCH', 'admin', 'member', { role: 'admin' });
  assert.equal(status, 403);
  assert.equal(roleOf(db, 'member'), 'member');
});

test('the owner promotes and demotes freely', async () => {
  const db = seed();

  assert.equal((await callMembers('PATCH', 'owner', 'member', { role: 'admin' })).status, 200);
  assert.equal(roleOf(db, 'member'), 'admin');

  assert.equal((await callMembers('PATCH', 'owner', 'admin', { role: 'member' })).status, 200);
  assert.equal(roleOf(db, 'admin'), 'member');
});

test('nobody changes their own role', async () => {
  const db = seed();
  const { status } = await callMembers('PATCH', 'admin', 'admin', { role: 'member' });
  assert.equal(status, 400);
  assert.equal(roleOf(db, 'admin'), 'admin');
});

// ---------------------------------------------------------------------------
// The last owner, at the storage layer
// ---------------------------------------------------------------------------

test('the last owner cannot be demoted, even below the route', async () => {
  // `removeMember()` has held this invariant since it was written; demotion was
  // the other way to reach an organization with no owner and had no guard at
  // all. The route refuses this case too, but the storage layer is where the
  // invariant belongs — it is what a script or a future caller meets first.
  const db = seed();
  const result = await updateMemberRole('membership-owner', 'member');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'last_owner');
  assert.equal(roleOf(db, 'owner'), 'owner');
});

test('an owner may be demoted once there is a second one', async () => {
  const people = PEOPLE.map((p) =>
    p.key === 'admin' ? { ...p, role: 'owner' } : p
  );
  const db = seed({ people });

  const result = await updateMemberRole('membership-admin', 'member');
  assert.equal(result.ok, true);
  assert.equal(ownerCount(db), 1);
});

test('ownership transfer promotes before it demotes', async () => {
  // Order matters for the failure case: a transfer interrupted between its two
  // statements should leave two owners (recoverable) rather than none.
  const db = seed();
  const { status } = await callMembers('PATCH', 'owner', 'member', { role: 'owner' });

  assert.equal(status, 200);
  assert.equal(roleOf(db, 'member'), 'owner', 'the new owner');
  assert.equal(roleOf(db, 'owner'), 'admin', 'the old owner steps down to admin');
  assert.equal(ownerCount(db), 1);
});

test('only the owner transfers ownership', async () => {
  const db = seed();
  const { status } = await callMembers('PATCH', 'admin', 'member', { role: 'owner' });
  assert.equal(status, 403);
  assert.equal(roleOf(db, 'member'), 'member');
});

// ---------------------------------------------------------------------------
// Removal and leaving
// ---------------------------------------------------------------------------

test('an admin removes members but not admins or the owner', async () => {
  const db = seed();

  assert.equal((await callMembers('DELETE', 'admin', 'member')).status, 200);
  assert.equal(roleOf(db, 'member'), undefined, 'the member is gone');

  assert.equal((await callMembers('DELETE', 'admin', 'owner')).status, 403);
  assert.equal(roleOf(db, 'owner'), 'owner');
});

test('anyone but the owner may leave', async () => {
  const db = seed();

  assert.equal((await callMembers('DELETE', 'member', 'member')).status, 200);
  assert.equal(roleOf(db, 'member'), undefined);

  const stuck = await callMembers('DELETE', 'owner', 'owner');
  assert.equal(stuck.status, 400, 'the owner has to hand the organization over first');
  assert.equal(roleOf(db, 'owner'), 'owner');
});

test('a plain member cannot remove anyone else', async () => {
  const db = seed();
  const { status } = await callMembers('DELETE', 'member', 'member2');
  assert.equal(status, 403);
  assert.equal(roleOf(db, 'member2'), 'member');
});

// ---------------------------------------------------------------------------
// Order and paging — what the list hands the UI
// ---------------------------------------------------------------------------

test('members come back owner, then admins, then members', async () => {
  seed();
  const members = await listOrganizationMembers(ORG, { limit: 10 });

  assert.deepEqual(
    members.map((m) => m.role),
    ['owner', 'admin', 'member', 'member'],
    'ORDER BY role DESC sorts the strings: owner → member → admin, which is not this'
  );
  assert.deepEqual(
    members.filter((m) => m.role === 'member').map((m) => m.user.email),
    ['mia@example.com', 'ben@example.com'],
    'within a role, oldest membership first'
  );
});

test('the order survives paging, so page two is the tail and not a reshuffle', async () => {
  seed();
  const first = await listOrganizationMembers(ORG, { limit: 2, offset: 0 });
  const second = await listOrganizationMembers(ORG, { limit: 2, offset: 2 });

  assert.deepEqual(first.map((m) => m.role), ['owner', 'admin']);
  assert.deepEqual(second.map((m) => m.role), ['member', 'member']);
  assert.equal(await countOrganizationMembers(ORG), 4, 'total counts the organization, not the page');
});

test('the route passes limit and offset through and reports the total', async () => {
  seed();
  const { req, res } = fakeExchange('GET');
  await handleOrganizationMembers({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://localhost/api/organizations/${ORG}/members?limit=2&offset=2`),
    authedUser: {
      email: 'mia@example.com',
      isAdmin: false,
      organizationId: ORG,
      organizationRole: 'member',
    },
  });

  const body = res.body();
  assert.equal(res.statusCode, 200);
  assert.equal(body.members.length, 2);
  assert.equal(body.total, 4);
  assert.equal(body.offset, 2);
});

// ---------------------------------------------------------------------------
// Measurement 3: the organization-settings admin keys
// ---------------------------------------------------------------------------

/** PATCH /api/settings/organization as `authedUser`, returning the status. */
async function patchOrgSettings(authedUser, body) {
  const { req, res } = fakeExchange('PATCH', body);
  await handleSettings({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL('http://localhost/api/settings/organization'),
    authedUser,
  });
  return res.statusCode;
}

/** An instance admin, seen inside ORG with the membership they hold there. */
const instanceAdmin = (email) => ({
  email,
  isAdmin: true,
  isDesigner: true,
  organizationId: ORG,
});

test('an instance admin who is a plain member cannot write organization settings', async () => {
  seed();
  assert.equal(
    await patchOrgSettings(instanceAdmin('mia@example.com'), { adminsAreDesigners: false }),
    401,
    'the instance flag stops at the edge of an organization someone only belongs to'
  );
  assert.equal(
    await patchOrgSettings(instanceAdmin('mia@example.com'), { rss: { enabled: true } }),
    401
  );
});

test('an instance admin who is an admin there writes them', async () => {
  const db = seed();
  assert.equal(
    await patchOrgSettings(instanceAdmin('adam@example.com'), { adminsAreDesigners: false }),
    200
  );
  assert.equal(
    db.__tables.organizations.find((o) => o.id === ORG).settings.adminsAreDesigners,
    false,
    'and the write actually landed'
  );
});

test('the membership narrows the instance role, it does not replace it', async () => {
  // The owner of the organization who is *not* an instance admin stays out:
  // the gate is the conjunction, so an organization role can only ever take
  // permission away, never hand it out.
  seed();
  assert.equal(
    await patchOrgSettings(
      { email: 'zoe@example.com', isAdmin: false, isDesigner: true, organizationId: ORG },
      { adminsAreDesigners: false }
    ),
    401
  );
});

test('the designer key is still judged on the designer capability', async () => {
  // Unchanged by this slice, and asserted here because the two gates sit on the
  // same handler: narrowing the admin one must not move the designer one.
  seed();
  assert.equal(
    await patchOrgSettings(
      { email: 'mia@example.com', isAdmin: false, isDesigner: true, organizationId: ORG },
      { disabledSlideTypes: ['title-slide'] }
    ),
    200,
    'a designer who is a plain member still disables slide types'
  );
});
