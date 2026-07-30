/**
 * Designer capability is held per organization, with MULTI_WORKSPACE_ENABLED
 * (organization UI, slice 3 / measurement 4).
 *
 * `resolveDesignerCapability()` opened with an unconditional
 * `if (user.isAdmin) return true`, placed *before* the membership lookup. The
 * comment above it said "admins get designer capability in single-user / non-DB
 * modes", but nothing gated it on those modes: an instance-wide admin carried
 * designer capability into every organization they switched to, regardless of
 * what their membership there said. That is the same asymmetry slice 2 removed
 * for the membership *role*, one capability later — and it reaches the routes
 * behind `canManage()` / `requiresDesigner()`: custom slide types, font
 * families and themes.
 *
 * The short-circuit now only applies when multi-workspace is off. This file
 * holds the assertions that fail without that change; every one of the
 * `isAdmin: true` cases below returns `true` under the old code.
 *
 * The mechanism underneath was already correct and is not what changed:
 * `hasDesignerCapability()` grants it to owners, to an explicit `is_designer`
 * membership, and to organization admins unless the organization sets
 * `adminsAreDesigners: false`. The gap was a bypass in front of it.
 *
 * MULTI_WORKSPACE_ENABLED is read at module scope (server/config/features.js:15),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process. The mirror-image file for the flag being
 * off is tests/designer-capability-org-scope.test.js.
 *
 * Run with: node --test tests/designer-capability-org-scope-multi-org.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MULTI_WORKSPACE_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG_A = process.env.DEFAULT_ORGANIZATION_ID;
const ORG_B = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { isMultiWorkspaceEnabled } = await import('../server/config/features.js');
const { resolveDesignerCapability } = await import('../server/utils/designer.js');
const { canManage } = await import('../server/utils/route-middleware.js');

test.before(() => {
  assert.equal(isMultiWorkspaceEnabled(), true, 'multi-workspace flag is on for this file');
});

/**
 * Seed one person who is an instance admin, a member of both organizations,
 * with the membership in ORG_B under the caller's control.
 *
 * @param {Object} [options]
 * @param {string} [options.roleInB] - Membership role in ORG_B.
 * @param {boolean} [options.designerInB] - Explicit `is_designer` in ORG_B.
 * @param {Object} [options.settingsB] - Settings on ORG_B.
 * @param {boolean} [options.memberOfB] - Whether the ORG_B membership exists.
 */
function seed({
  roleInB = 'member',
  designerInB = false,
  settingsB = {},
  memberOfB = true,
} = {}) {
  const memberships = [
    {
      id: 'membership-a',
      user_id: 'user-alice',
      organization_id: ORG_A,
      role: 'owner',
      is_designer: false,
      joined_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  if (memberOfB) {
    memberships.push({
      id: 'membership-b',
      user_id: 'user-alice',
      organization_id: ORG_B,
      role: roleInB,
      is_designer: designerInB,
      joined_at: '2026-03-01T00:00:00.000Z',
    });
  }

  const db = createFakeDb({
    organizations: [
      { id: ORG_A, name: 'Alpha', slug: 'alpha', settings: {} },
      { id: ORG_B, name: 'Beta', slug: 'beta', settings: settingsB },
    ],
    users: [
      {
        id: 'user-alice',
        organization_id: ORG_A,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'admin',
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

/** The instance admin, as the session sees them inside `organizationId`. */
const admin = (organizationId) => ({
  email: 'alice@example.com',
  isAdmin: true,
  organizationId,
});

// ---------------------------------------------------------------------------
// The bypass is gone
// ---------------------------------------------------------------------------

test('an instance admin who is a plain member is not a designer there', async () => {
  seed({ roleInB: 'member' });
  assert.equal(
    await resolveDesignerCapability(admin(ORG_B)),
    false,
    'the instance flag must not carry designer capability across the switch'
  );
});

test('the same person is still a designer in the organization they own', async () => {
  seed({ roleInB: 'member' });
  assert.equal(await resolveDesignerCapability(admin(ORG_A)), true);
});

test('an instance admin with no membership at all gets nothing', async () => {
  seed({ memberOfB: false });
  assert.equal(await resolveDesignerCapability(admin(ORG_B)), false);
});

// ---------------------------------------------------------------------------
// What the membership does grant — unchanged mechanism, now actually reached
// ---------------------------------------------------------------------------

test('an explicit designer flag on the membership grants it', async () => {
  seed({ roleInB: 'member', designerInB: true });
  assert.equal(await resolveDesignerCapability(admin(ORG_B)), true);
});

test('an organization admin inherits it unless the organization opts out', async () => {
  seed({ roleInB: 'admin' });
  assert.equal(
    await resolveDesignerCapability(admin(ORG_B)),
    true,
    'adminsAreDesigners defaults to on'
  );

  seed({ roleInB: 'admin', settingsB: { adminsAreDesigners: false } });
  assert.equal(
    await resolveDesignerCapability(admin(ORG_B)),
    false,
    'an organization that turns it off is obeyed'
  );
});

test('an owner always has it', async () => {
  seed({ roleInB: 'owner', settingsB: { adminsAreDesigners: false } });
  assert.equal(await resolveDesignerCapability(admin(ORG_B)), true);
});

test('someone who is not an instance admin is judged the same way', async () => {
  // Nothing about this path changed, but it is the baseline the admin case is
  // now measured against: the two must agree.
  seed({ roleInB: 'member', designerInB: true });
  const member = { email: 'alice@example.com', isAdmin: false, organizationId: ORG_B };
  assert.equal(await resolveDesignerCapability(member), true);

  seed({ roleInB: 'member', designerInB: false });
  assert.equal(
    await resolveDesignerCapability({ ...member }),
    false
  );
});

test('no email, no capability', async () => {
  seed();
  assert.equal(await resolveDesignerCapability({ isAdmin: true }), false);
  assert.equal(await resolveDesignerCapability(null), false);
});

// ---------------------------------------------------------------------------
// The second bypass, at the route gate
// ---------------------------------------------------------------------------

test('canManage does not reopen what the capability resolution closed', () => {
  // Measured in the browser before this changed: signed in as an instance admin
  // who is a plain member of the active organization, `/api/auth/me` already
  // said `isDesigner: false` — and `POST /api/font-families` still answered 201,
  // because `canManage()` carried its own `|| isAdmin`. Scoping designer.js
  // alone leaves two of the three route families measurement 4 names
  // (custom-slide-types, font-families) wide open.
  assert.equal(
    canManage({ isAdmin: true, isDesigner: false }),
    false,
    'the instance flag is not a second door into an organization'
  );
  assert.equal(canManage({ isAdmin: true, isDesigner: true }), true);
  assert.equal(canManage({ isAdmin: false, isDesigner: true }), true);
  assert.equal(canManage({ isAdmin: false, isDesigner: false }), false);
  assert.equal(canManage(null), false);
});
