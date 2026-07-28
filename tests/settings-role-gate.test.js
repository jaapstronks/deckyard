/**
 * The settings admin gate follows the membership role, not the instance flag
 * (organization UI, slice 2).
 *
 * Two role systems meet on the user object: `isAdmin` is instance-wide,
 * `organizationRole` is the role held in the organization the session is
 * currently in. Before this change the admin tabs were gated on `isAdmin`
 * alone, so someone who is admin in organization A stayed admin in
 * organization B the moment they switched.
 *
 * What this pins down:
 *
 *   - Single-workspace instances behave exactly as before: no
 *     `organizationRole` on the user means the gate is `isAdmin`.
 *   - In multi-workspace mode the membership role only ever *narrows* the
 *     instance flag. It never grants: the instance-scoped APIs behind these
 *     tabs (admin users, email, integrations, API keys, analytics) still check
 *     `isAdmin`, so showing them to an organization admin who is not an
 *     instance admin would be showing tabs that answer 403.
 *
 * Run with: node --test tests/settings-role-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/settings',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;

const { isWorkspaceAdmin, getWorkspaceRole, hasWorkspaceRole } = await import(
  '../client/lib/user/workspace-role.js'
);
const { createSettingsSidebar } = await import(
  '../client/views/settings/settings-sidebar.js'
);

/** The instance admin, seen from an organization where they hold `role`. */
const admin = (role) => ({
  email: 'jaap@example.com',
  isAdmin: true,
  ...(role === undefined ? {} : { organizationRole: role }),
});

/** Tab keys the sidebar actually renders for this user. */
function visibleTabKeys(user) {
  const sidebar = createSettingsSidebar({
    isAdmin: isWorkspaceAdmin(user),
    isDesigner: false,
    activeTab: 'account',
    onTabChange: () => {},
  });
  return Array.from(sidebar.el.querySelectorAll('[data-tab]')).map((b) => b.dataset.tab);
}

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

test('single-workspace: the gate is the instance flag, unchanged', () => {
  assert.equal(isWorkspaceAdmin(admin(undefined)), true, 'no membership role, no narrowing');
  assert.equal(isWorkspaceAdmin(admin(null)), true, 'an explicit null reads the same');
  assert.equal(isWorkspaceAdmin({ email: 'a@example.com', isAdmin: false }), false);
  assert.equal(isWorkspaceAdmin(undefined), false, 'no user is not an admin');
});

test('multi-workspace: the membership role narrows the instance flag', () => {
  assert.equal(isWorkspaceAdmin(admin('owner')), true);
  assert.equal(isWorkspaceAdmin(admin('admin')), true);
  assert.equal(
    isWorkspaceAdmin(admin('member')),
    false,
    'admin in one organization is not admin in the one they switched to'
  );
});

test('the membership role never grants what the instance flag withholds', () => {
  // The APIs behind these tabs are instance-scoped and still check isAdmin.
  assert.equal(isWorkspaceAdmin({ isAdmin: false, organizationRole: 'owner' }), false);
  assert.equal(isWorkspaceAdmin({ isAdmin: false, organizationRole: 'admin' }), false);
});

test('an unknown role is treated as no role at all', () => {
  assert.equal(getWorkspaceRole({ organizationRole: 'superuser' }), null);
  assert.equal(getWorkspaceRole({ organizationRole: 'owner' }), 'owner');
  assert.equal(
    isWorkspaceAdmin({ isAdmin: true, organizationRole: 'superuser' }),
    true,
    'a role the client does not know falls back to the instance flag'
  );
});

test('hasWorkspaceRole ranks the roles like the server does', () => {
  assert.equal(hasWorkspaceRole('owner', 'admin'), true);
  assert.equal(hasWorkspaceRole('admin', 'admin'), true);
  assert.equal(hasWorkspaceRole('member', 'admin'), false);
  assert.equal(hasWorkspaceRole(null, 'member'), false);
});

test('the client ladder is still the server ladder', async () => {
  // workspace-role.js copies WORKSPACE_ROLES because the client cannot import
  // from server/. A copy drifts, and this one drifts *open*: a role the client
  // does not recognise reads as "no role", which falls back to the bare isAdmin
  // check the gate exists to narrow. So pin the mirror rather than the comment.
  const { WORKSPACE_ROLES, hasWorkspaceRole: serverHasRole } = await import(
    '../server/storage/user-organizations/memberships.js'
  );

  for (const role of WORKSPACE_ROLES) {
    assert.equal(
      getWorkspaceRole({ organizationRole: role }),
      role,
      `the client does not know the membership role "${role}" — update ` +
        'WORKSPACE_ROLES in client/lib/user/workspace-role.js'
    );
  }

  // Same ranking for every pair, not just the ones the gate happens to ask for.
  for (const role of WORKSPACE_ROLES) {
    for (const required of WORKSPACE_ROLES) {
      assert.equal(
        hasWorkspaceRole(role, required),
        serverHasRole(role, required),
        `client and server disagree on whether "${role}" satisfies "${required}"`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// What the user actually sees
// ---------------------------------------------------------------------------

const ADMIN_TABS = ['admin', 'users', 'api-keys', 'email', 'integrations', 'analytics'];
const USER_TABS = ['account', 'preferences', 'export'];

test('the admin tabs disappear in an organization where you are a member', () => {
  assert.deepEqual(visibleTabKeys(admin('admin')), [...USER_TABS, ...ADMIN_TABS]);
  assert.deepEqual(
    visibleTabKeys(admin('member')),
    USER_TABS,
    'switching to an organization where you are a member takes the tabs with it'
  );
});

test('single-workspace keeps every admin tab it had', () => {
  assert.deepEqual(visibleTabKeys(admin(undefined)), [...USER_TABS, ...ADMIN_TABS]);
});
