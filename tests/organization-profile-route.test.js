/**
 * The organization's own record: who may read it, write it, and delete it
 * (organization UI, slice 6).
 *
 * The profile screen mirrors `server/routes/api/organizations.js`, so this file
 * pins what it is mirroring. Two of the assertions fail against the code as
 * slice 5 left it:
 *
 *   1. **`deleteOrganization()` hard-coded the seed UUID** of the default
 *      organization instead of asking `getDefaultOrganizationId()` for it. The
 *      default organization is what every single-organization path falls back to
 *      and is the one organization that may not be removed — but on an instance
 *      that sets `DEFAULT_ORGANIZATION_ID`, the guard protected an organization
 *      that need not even exist and left the real fallback deletable by its
 *      owner. Invisible on a stock install, wrong on a configured one, and this
 *      is the slice that first puts a button on that route.
 *   2. **`GET /api/organizations/:id` did not say whether this is that
 *      organization.** Nothing else on the wire does either, so the profile
 *      screen could only offer its owner a Delete button that the route is
 *      certain to refuse. One boolean on the response is what lets the UI draw
 *      the rule instead of discovering it.
 *
 * MULTI_ORG_ENABLED is read at module scope (server/config/features.js),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/organization-profile-route.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MULTI_ORG_ENABLED = 'true';
// Deliberately *not* the seed UUID the storage layer used to compare against.
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const DEFAULT_ORG = '00000000-0000-0000-0000-0000000000aa';
const ORG = '00000000-0000-0000-0000-0000000000bb';
const SEED_ORG = '00000000-0000-0000-0000-000000000001';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { handleOrganizations } =
  await import('../server/routes/api/organizations.js');
const { isDefaultOrganization, deleteOrganization } =
  await import('../server/storage/user-organizations/index.js');

/** The cast, all in ORG unless a test says otherwise. */
const PEOPLE = [
  { key: 'owner', email: 'zoe@example.com', role: 'owner' },
  { key: 'admin', email: 'adam@example.com', role: 'admin' },
  { key: 'member', email: 'mia@example.com', role: 'member' },
];

/**
 * Seed both organizations and install the double.
 * @returns {Object} The double.
 */
function seed() {
  const organizations = [
    {
      id: ORG,
      name: 'Beta',
      slug: 'beta',
      display_name: null,
      description: null,
      settings: {},
    },
    {
      id: DEFAULT_ORG,
      name: 'House',
      slug: 'house',
      display_name: null,
      description: null,
      settings: {},
    },
    {
      id: SEED_ORG,
      name: 'Seed',
      slug: 'seed',
      display_name: null,
      description: null,
      settings: {},
    },
  ];

  const users = [];
  const memberships = [];
  for (const orgId of [ORG, DEFAULT_ORG, SEED_ORG]) {
    for (const person of PEOPLE) {
      const suffix = orgId === ORG ? '' : `-${orgId.slice(-2)}`;
      users.push({
        id: `user-${person.key}${suffix}`,
        organization_id: orgId,
        email: suffix ? `${person.key}${suffix}@example.com` : person.email,
        name: person.key,
        role: 'user',
        auth_source: 'database',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      });
      memberships.push({
        id: `membership-${person.key}${suffix}`,
        user_id: `user-${person.key}${suffix}`,
        organization_id: orgId,
        role: person.role,
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      });
    }
  }

  const db = createFakeDb({
    organizations,
    users,
    user_organizations: memberships,
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
 * Call the organizations route as one of the cast.
 *
 * @param {string} method - HTTP method.
 * @param {string} actorKey - Who is acting (a PEOPLE key).
 * @param {Object} [options]
 * @param {string} [options.organizationId=ORG] - Organization in the path.
 * @param {string} [options.email] - Override the actor's email.
 * @param {Object} [options.body] - Request body.
 * @returns {Promise<{status: number, body: Object|null}>}
 */
async function callOrganizations(
  method,
  actorKey,
  { organizationId = ORG, email, body } = {},
) {
  const actor = PEOPLE.find((p) => p.key === actorKey);
  const path = `/api/organizations/${organizationId}`;
  const { req, res } = fakeExchange(method, body);
  await handleOrganizations({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://localhost${path}`),
    authedUser: {
      email: email || actor.email,
      isAdmin: false,
      organizationId,
      organizationRole: actor.role,
    },
  });
  return { status: res.statusCode, body: res.body() };
}

// ---------------------------------------------------------------------------
// The guard that decides whether the Delete button exists
// ---------------------------------------------------------------------------

test('the undeletable organization is the configured one, not the seed UUID', () => {
  assert.equal(isDefaultOrganization(DEFAULT_ORG), true);
  assert.equal(
    isDefaultOrganization(SEED_ORG),
    false,
    'the seed UUID is not special once DEFAULT_ORGANIZATION_ID names another',
  );
  assert.equal(isDefaultOrganization(ORG), false);
  assert.equal(isDefaultOrganization(undefined), false);
});

test('deleting the configured default organization is refused', async () => {
  seed();
  const refused = await deleteOrganization(DEFAULT_ORG);
  assert.deepEqual(refused, { ok: false, reason: 'cannot_delete_default' });
});

test('the seed organization is deletable when it is not the default', async () => {
  const db = seed();
  // The old guard compared against this UUID literally, so it survived here and
  // the actual fallback organization above did not.
  const deleted = await deleteOrganization(SEED_ORG);
  assert.deepEqual(deleted, { ok: true });
  assert.equal(
    db.__tables.organizations.some((o) => o.id === SEED_ORG),
    false,
  );
});

// ---------------------------------------------------------------------------
// GET — every member reads the profile, and learns whether it can be deleted
// ---------------------------------------------------------------------------

test('a plain member may read the organization', async () => {
  seed();
  const res = await callOrganizations('GET', 'member');
  assert.equal(res.status, 200);
  assert.equal(res.body.organization.name, 'Beta');
  assert.equal(res.body.membership.role, 'member');
});

test('the response says whether this organization may be deleted at all', async () => {
  seed();
  const ordinary = await callOrganizations('GET', 'owner');
  assert.equal(ordinary.body.organization.isDefault, false);

  const fallback = await callOrganizations('GET', 'owner', {
    organizationId: DEFAULT_ORG,
    email: `owner-${DEFAULT_ORG.slice(-2)}@example.com`,
  });
  assert.equal(
    fallback.body.organization.isDefault,
    true,
    'without this the owner of the default organization gets a button that only 403s',
  );
});

test('someone outside the organization reads nothing', async () => {
  seed();
  const res = await callOrganizations('GET', 'owner', {
    email: 'stranger@example.com',
  });
  assert.equal(res.status, 401, 'no account on this instance');

  const outsider = await callOrganizations('GET', 'owner', {
    organizationId: DEFAULT_ORG,
    email: PEOPLE[0].email,
  });
  assert.equal(outsider.status, 403, 'an account, but not a member here');
});

// ---------------------------------------------------------------------------
// PATCH — admin and owner write, a member does not
// ---------------------------------------------------------------------------

test('an admin may rewrite the profile; a plain member may not', async () => {
  const db = seed();

  const byAdmin = await callOrganizations('PATCH', 'admin', {
    body: { name: 'Beta Works', displayName: 'Beta', description: null },
  });
  assert.equal(byAdmin.status, 200);
  assert.equal(byAdmin.body.organization.name, 'Beta Works');
  assert.equal(
    db.__tables.organizations.find((o) => o.id === ORG).name,
    'Beta Works',
  );

  const byMember = await callOrganizations('PATCH', 'member', {
    body: { name: 'Mine now' },
  });
  assert.equal(byMember.status, 403);
  assert.equal(
    db.__tables.organizations.find((o) => o.id === ORG).name,
    'Beta Works',
  );
});

test('a one-character name is refused, so the form checks the same thing', async () => {
  seed();
  const res = await callOrganizations('PATCH', 'owner', {
    body: { name: 'B' },
  });
  assert.equal(res.status, 400);
});

test('only the fields that are sent are touched', async () => {
  const db = seed();
  await callOrganizations('PATCH', 'owner', {
    body: { description: 'A organization' },
  });
  const row = db.__tables.organizations.find((o) => o.id === ORG);
  assert.equal(row.description, 'A organization');
  assert.equal(row.name, 'Beta', 'the untouched field kept its value');
});

// ---------------------------------------------------------------------------
// DELETE — the owner alone, and not the default
// ---------------------------------------------------------------------------

test('an admin cannot delete the organization', async () => {
  const db = seed();
  const res = await callOrganizations('DELETE', 'admin');
  assert.equal(res.status, 403);
  assert.equal(
    db.__tables.organizations.some((o) => o.id === ORG),
    true,
  );
});

test('the owner can, and everything hanging off it goes with it', async () => {
  const db = seed();
  const res = await callOrganizations('DELETE', 'owner');
  assert.equal(res.status, 200);
  assert.equal(
    db.__tables.organizations.some((o) => o.id === ORG),
    false,
  );
});

test('the owner of the default organization is refused by the route too', async () => {
  seed();
  const res = await callOrganizations('DELETE', 'owner', {
    organizationId: DEFAULT_ORG,
    email: `owner-${DEFAULT_ORG.slice(-2)}@example.com`,
  });
  assert.equal(res.status, 403);
  assert.match(res.body?.message || '', /default organization/i);
});
