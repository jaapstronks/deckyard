/**
 * Designer capability on a single-workspace instance — the half of
 * measurement 4 that must *not* change.
 *
 * Scoping the `isAdmin` short-circuit in `resolveDesignerCapability()` to
 * single-workspace mode is only safe if single-workspace mode keeps behaving
 * exactly as it did. That covers more than the ordinary install: with auth
 * disabled, under the dev bypass, and in sandbox mode there is no membership
 * row to read at all, so `isAdmin` standing in for one is the only thing
 * holding those modes' designer surfaces up.
 *
 * The multi-workspace side lives in
 * tests/designer-capability-org-scope-multi-org.test.js; MULTI_WORKSPACE_ENABLED
 * is read at module scope, so the two cases need separate files.
 *
 * Run with: node --test tests/designer-capability-org-scope.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MULTI_WORKSPACE_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { isMultiWorkspaceEnabled } = await import('../server/config/features.js');
const { resolveDesignerCapability } = await import('../server/utils/designer.js');
const { canManage } = await import('../server/utils/route-middleware.js');

test.before(() => {
  assert.equal(isMultiWorkspaceEnabled(), false, 'multi-workspace flag is off for this file');
});

/**
 * @param {Object} [options]
 * @param {Array<Object>} [options.memberships] - Membership rows to seed.
 * @param {Object} [options.settings] - Settings on the organization.
 */
function seed({ memberships = [], settings = {} } = {}) {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Alpha', slug: 'alpha', settings }],
    users: [
      {
        id: 'user-alice',
        organization_id: ORG,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'admin',
        auth_source: 'database',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
      {
        id: 'user-bob',
        organization_id: ORG,
        email: 'bob@example.com',
        name: 'Bob',
        role: 'user',
        auth_source: 'database',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
    ],
    user_organizations: memberships,
  });
  __setTestDb(db);
  return db;
}

test('an instance admin is a designer, membership row or not', async () => {
  seed();
  assert.equal(
    await resolveDesignerCapability({ email: 'alice@example.com', isAdmin: true, organizationId: ORG }),
    true,
    'auth off / dev bypass / sandbox have no membership to read'
  );

  seed({
    memberships: [
      {
        id: 'membership-a',
        user_id: 'user-alice',
        organization_id: ORG,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  assert.equal(
    await resolveDesignerCapability({ email: 'alice@example.com', isAdmin: true, organizationId: ORG }),
    true,
    'and a membership that says otherwise does not take it away here'
  );
});

test('the admin short-circuit costs no database work', async () => {
  const db = seed();
  await resolveDesignerCapability({ email: 'alice@example.com', isAdmin: true, organizationId: ORG });
  assert.deepEqual(
    db.__queryLog,
    [],
    'single-workspace answers this from the instance flag alone'
  );
});

test('a non-admin is still judged on the membership', async () => {
  seed({
    memberships: [
      {
        id: 'membership-b',
        user_id: 'user-bob',
        organization_id: ORG,
        role: 'member',
        is_designer: true,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  assert.equal(
    await resolveDesignerCapability({ email: 'bob@example.com', isAdmin: false, organizationId: ORG }),
    true
  );

  seed({
    memberships: [
      {
        id: 'membership-b',
        user_id: 'user-bob',
        organization_id: ORG,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  assert.equal(
    await resolveDesignerCapability({ email: 'bob@example.com', isAdmin: false, organizationId: ORG }),
    false
  );
});

test('a non-admin with no membership gets nothing', async () => {
  seed();
  assert.equal(
    await resolveDesignerCapability({ email: 'bob@example.com', isAdmin: false, organizationId: ORG }),
    false
  );
});

test('canManage keeps its admin fallback here', () => {
  // Redundant in the ordinary case — `isDesigner` is already true for an admin
  // on a single-workspace instance — but it is what keeps the only admin in
  // when capability resolution fails open (routes/api/index.js swallows the
  // error and leaves `isDesigner` unset).
  assert.equal(canManage({ isAdmin: true, isDesigner: false }), true);
  assert.equal(canManage({ isAdmin: true }), true);
  assert.equal(canManage({ isAdmin: false, isDesigner: true }), true);
  assert.equal(canManage({ isAdmin: false, isDesigner: false }), false);
  assert.equal(canManage(null), false);
});
