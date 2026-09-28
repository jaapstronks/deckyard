/**
 * Who may create an organization (B424).
 *
 * `MULTI_ORG_USER_CREATE_ENABLED` is the operator's choice: on (default),
 * `POST /api/organizations` is open to every signed-in user, as it always was;
 * off, only instance admins may create one and anyone else gets a 403 before
 * the body is read, so the refusal writes nothing. A pre-provisioned instance
 * (the operator creates each customer's organization) turns it off.
 *
 * The flag is read per call, so each test sets it; `MULTI_ORG_ENABLED` is set
 * before the route is imported, the same way the neighbouring route tests do.
 *
 * Run with: node --test tests/organization-create-admin-only.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MULTI_ORG_ENABLED = 'true';

const ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { handleOrganizations } =
  await import('../server/routes/api/organizations.js');

/** One organization, one plain user and one instance admin in it. */
function seed() {
  const users = [
    { id: 'user-plain', email: 'mia@example.com', role: 'user' },
    { id: 'user-admin', email: 'ada@example.com', role: 'admin' },
  ].map((u) => ({
    ...u,
    organization_id: ORG,
    name: u.id,
    auth_source: 'database',
    created_at: '2026-01-01T00:00:00.000Z',
    settings: {},
  }));
  const db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Beta',
        slug: 'beta',
        display_name: null,
        description: null,
        settings: {},
      },
    ],
    users,
    user_organizations: users.map((u) => ({
      id: `membership-${u.id}`,
      user_id: u.id,
      organization_id: ORG,
      role: 'member',
      is_designer: false,
      joined_at: '2026-01-01T00:00:00.000Z',
    })),
  });
  __setTestDb(db);
  return db;
}

/**
 * POST /api/organizations as a plain user or an instance admin.
 *
 * @param {{ isAdmin: boolean }} actor
 * @returns {Promise<{status: number, body: Object|null}>}
 */
async function create({ isAdmin }) {
  const chunks = [];
  const res = {
    statusCode: null,
    writeHead(status) {
      res.statusCode = status;
    },
    end(payload) {
      if (payload) chunks.push(payload);
    },
  };
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ name: 'Gamma', slug: 'gamma' }));
    },
  };
  await handleOrganizations({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL('http://localhost/api/organizations'),
    authedUser: {
      email: isAdmin ? 'ada@example.com' : 'mia@example.com',
      isAdmin,
      organizationId: ORG,
      organizationRole: 'member',
    },
  });
  return { status: res.statusCode, body: JSON.parse(chunks.join('')) };
}

/** @param {Object} db */
const organizationCount = (db) => db.__tables.organizations.length;

test('flag unset: a plain user creates an organization (default unchanged)', async () => {
  delete process.env.MULTI_ORG_USER_CREATE_ENABLED;
  const db = seed();
  const { status, body } = await create({ isAdmin: false });
  assert.equal(status, 201);
  assert.equal(body.organization.slug, 'gamma');
  assert.equal(organizationCount(db), 2);
});

test('flag on: a plain user creates an organization', async () => {
  process.env.MULTI_ORG_USER_CREATE_ENABLED = 'true';
  const db = seed();
  const { status } = await create({ isAdmin: false });
  assert.equal(status, 201);
  assert.equal(organizationCount(db), 2);
});

test('flag off: a plain user is refused with a 403 and nothing is written', async () => {
  process.env.MULTI_ORG_USER_CREATE_ENABLED = 'false';
  const db = seed();
  const { status, body } = await create({ isAdmin: false });
  assert.equal(status, 403);
  assert.equal(body.error, 'forbidden');
  assert.match(body.message, /instance admins/);
  assert.equal(organizationCount(db), 1);
  assert.equal(db.__tables.user_organizations.length, 2);
});

test('flag off: an instance admin still creates an organization', async () => {
  process.env.MULTI_ORG_USER_CREATE_ENABLED = 'false';
  const db = seed();
  const { status, body } = await create({ isAdmin: true });
  assert.equal(status, 201);
  assert.equal(body.organization.slug, 'gamma');
  assert.equal(organizationCount(db), 2);
});
