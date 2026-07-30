/**
 * The Users tab becomes the member list of the active organization
 * (organization UI, slice 3).
 *
 * Measurement 2.1 of the briefing: `/api/admin/users` lists people by
 * `users.organization_id` — their *home* organization, which since phase 0 is
 * explicitly no longer the authority on where someone works — and enriches them
 * with designer status against a hard-coded `getDefaultOrganizationId()`. On a
 * single-workspace instance both are invisibly right; the moment there is a
 * second organization the tab shows the wrong population with the wrong
 * designer flag. So in multi-workspace mode the tab asks the organization
 * instead, via `GET /api/organizations/:id/members`.
 *
 * The load-bearing pair is the first two tests: which endpoint each mode asks,
 * and — just as much — which one it does *not*. A single-workspace instance
 * must keep hitting `/api/admin/users` and must never touch the organization
 * surface, which is behind the feature flag on the server and answers 403.
 *
 * The list is read-only on purpose. Role changes, removal, leaving and
 * ownership transfer are slice 4; an affordance that 403s is worse than none,
 * so the cards carry no buttons yet and the test pins that.
 *
 * Run with: node --test tests/organization-members-panel.test.js
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
globalThis.getComputedStyle = dom.window.getComputedStyle;

const ORG_B = '00000000-0000-0000-0000-0000000000bb';

const MEMBERS = [
  {
    membershipId: 'm-1',
    role: 'owner',
    isDesigner: false,
    joinedAt: '2026-01-05T00:00:00.000Z',
    user: { id: 'u-1', email: 'owner@example.com', name: 'Olive Owner' },
  },
  {
    membershipId: 'm-2',
    role: 'admin',
    isDesigner: false,
    joinedAt: '2026-02-05T00:00:00.000Z',
    user: { id: 'u-2', email: 'admin@example.com', name: null },
  },
  {
    membershipId: 'm-3',
    role: 'member',
    isDesigner: true,
    joinedAt: '2026-03-05T00:00:00.000Z',
    user: { id: 'u-3', email: 'designer@example.com', name: 'Dana Designer' },
  },
];

// Record every request the UI makes, so "asks the other endpoint" and "asks
// nothing else" are both assertable.
let requested = [];
globalThis.fetch = async (input, init = {}) => {
  const path = String(input);
  requested.push(`${init?.method || 'GET'} ${path}`);
  const body = path.includes('/members')
    ? { members: MEMBERS, total: MEMBERS.length }
    : { users: [] };
  // Node's own Response, not jsdom's — this jsdom build does not expose one.
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { setFeatures } = await import('../client/lib/state/features.js');
const { createUsersTab } = await import('../client/views/settings/tabs/users-tab.js');
const { renderMembersList } = await import(
  '../client/views/settings/organization-members/member-list.js'
);
const { renderOrganizationMembersPanel } = await import(
  '../client/views/settings/organization-members/panel.js'
);
const { createSettingsSidebar } = await import(
  '../client/views/settings/settings-sidebar.js'
);

/** The signed-in instance admin, inside organization B. */
const USER = {
  email: 'admin@example.com',
  isAdmin: true,
  organizationId: ORG_B,
  organizationRole: 'admin',
};

/** Let the panel's fetch and its `.then` chain settle. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test.beforeEach(() => {
  requested = [];
});

// ---------------------------------------------------------------------------
// Which endpoint each mode asks
// ---------------------------------------------------------------------------

test('single-workspace keeps the instance user list and never asks the organization', async () => {
  setFeatures({ multiWorkspace: false });
  const tab = createUsersTab({ user: USER });
  tab.load();
  await settle();

  assert.ok(
    requested.some((r) => r.includes('/api/admin/users')),
    'the instance-wide list is still what a single-workspace instance shows'
  );
  assert.equal(
    requested.filter((r) => r.includes('/api/organizations/')).length,
    0,
    'the organization surface is behind the feature flag and answers 403 — do not ask'
  );
});

test('multi-workspace asks the active organization for its members', async () => {
  setFeatures({ multiWorkspace: true });
  const tab = createUsersTab({ user: USER });
  tab.load();
  await settle();

  assert.deepEqual(requested, [
    `GET /api/organizations/${ORG_B}/members?limit=100`,
  ]);
  assert.equal(
    requested.filter((r) => r.includes('/api/admin/users')).length,
    0,
    'the instance-wide list is the wrong population here — measurement 2.1'
  );
  // And the answer actually reaches the screen.
  assert.equal(tab.el.querySelectorAll('.admin-user-card').length, MEMBERS.length);
  assert.match(tab.el.textContent, /designer@example\.com/);
});

test('the organization on the request is the session’s, not the default one', async () => {
  setFeatures({ multiWorkspace: true });
  const panel = renderOrganizationMembersPanel({
    user: { ...USER, organizationId: 'org-switched-into' },
  });
  await panel.ready;

  assert.deepEqual(requested, ['GET /api/organizations/org-switched-into/members?limit=100']);
});

test('a session with no active organization asks nothing and says so', async () => {
  setFeatures({ multiWorkspace: true });
  const panel = renderOrganizationMembersPanel({ user: { email: 'a@example.com' } });
  await panel.ready;

  assert.deepEqual(requested, [], 'nothing to ask for');
  assert.match(panel.el.textContent, /Could not load the member list/);
});

test('a failed load leaves a message, not a permanently loading list', async () => {
  setFeatures({ multiWorkspace: true });
  const panel = renderOrganizationMembersPanel({
    user: USER,
    load: async () => {
      throw new Error('boom');
    },
  });
  await panel.ready;

  assert.match(panel.el.textContent, /Could not load the member list/);
  assert.doesNotMatch(panel.el.textContent, /Loading/);
});

// ---------------------------------------------------------------------------
// What the list shows
// ---------------------------------------------------------------------------

/** Render the member list standalone and hand back its container. */
function renderList(members, currentUser = USER, total = undefined) {
  const container = dom.window.document.createElement('div');
  renderMembersList(container, members, currentUser, total);
  return container;
}

test('every member carries a role', async () => {
  const container = renderList(MEMBERS);
  const badges = Array.from(container.querySelectorAll('.admin-user-role-badge')).map(
    (b) => b.textContent
  );
  assert.ok(badges.includes('Owner'));
  assert.ok(badges.includes('Admin'));
  assert.ok(badges.includes('Member'));
});

test('the designer badge follows the explicit flag, not the role', async () => {
  const cards = Array.from(renderList(MEMBERS).querySelectorAll('.admin-user-card'));
  const designerOn = (card) =>
    Boolean(card.querySelector('.admin-user-role-badge.is-designer'));

  // The owner *has* designer capability through their role, but no flag is set
  // on the membership — badging them would show a flag that is not there. Only
  // the member with `isDesigner: true` is badged.
  assert.equal(designerOn(cards[0]), false, 'owner: capability by role, no flag');
  assert.equal(designerOn(cards[1]), false, 'admin: capability by role, no flag');
  assert.equal(designerOn(cards[2]), true, 'member: explicit is_designer');
});

test('the signed-in person is marked in the list', async () => {
  const container = renderList(MEMBERS);
  const cards = Array.from(container.querySelectorAll('.admin-user-card'));
  const youOn = (card) =>
    Array.from(card.querySelectorAll('.admin-user-role-badge')).some(
      (b) => b.textContent === 'You'
    );
  assert.equal(youOn(cards[1]), true, 'admin@example.com is the signed-in user');
  assert.equal(youOn(cards[0]), false);
});

test('the list is read-only until slice 4', async () => {
  const container = renderList(MEMBERS);
  assert.equal(
    container.querySelectorAll('button').length,
    0,
    'no management affordances yet — the actions land with their 403 handling in slice 4'
  );
});

test('a truncated page says it is truncated', async () => {
  const complete = renderList(MEMBERS, USER, MEMBERS.length);
  assert.doesNotMatch(complete.textContent, /Showing/);

  const truncated = renderList(MEMBERS, USER, 140);
  assert.match(
    truncated.textContent,
    /Showing 3 of 140 members/,
    'a page that does not hold the organization must not read as one that does'
  );
});

test('an empty organization is not an error', async () => {
  const container = renderList([]);
  assert.match(container.textContent, /No members found/);
});

// ---------------------------------------------------------------------------
// The tab label follows the mode
// ---------------------------------------------------------------------------

/** The sidebar label rendered for the users tab. */
function usersTabLabel() {
  const sidebar = createSettingsSidebar({
    isAdmin: true,
    isDesigner: false,
    activeTab: 'account',
    onTabChange: () => {},
  });
  return sidebar.el.querySelector('[data-tab="users"]').textContent;
}

test('the tab is called Users on an instance, Members inside an organization', async () => {
  setFeatures({ multiWorkspace: false });
  assert.equal(usersTabLabel(), 'Users');

  setFeatures({ multiWorkspace: true });
  assert.equal(usersTabLabel(), 'Members');
});

test('the tab key is unchanged, so deep links and the gate still work', async () => {
  setFeatures({ multiWorkspace: true });
  const tab = createUsersTab({ user: USER });
  assert.equal(tab.el.dataset.tab, 'users');
  assert.equal(tab.el.id, 'settings-tab-users');
});
