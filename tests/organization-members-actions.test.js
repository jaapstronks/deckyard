/**
 * Managing the member list from the UI (organization UI, slice 4).
 *
 * Slice 3 left the rows read-only on the grounds that an affordance which 403s
 * is worse than none. Slice 4 keeps that rule and applies it per row instead of
 * per screen: `permissions.js` mirrors the route's checks, so a control certain
 * to be refused is never drawn.
 *
 * Two things this file is careful about, because they are where the reasoning
 * is easy to get wrong:
 *
 *   - **The mirror is not the authority.** It can be stale — your own role may
 *     have changed since the page loaded — so the refusal path is tested as an
 *     ordinary outcome, with the server's own sentence surfacing rather than a
 *     generic failure, and with the screen never claiming a change that did not
 *     happen.
 *   - **Two actions change the viewer, not a peer.** Leaving the organization
 *     and handing it over both invalidate every gate the page was drawn with,
 *     so they end in a full reload for the same reason switching organizations
 *     does (briefing decision 4).
 *
 * Run with: node --test tests/organization-members-actions.test.js
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
// The modal helpers focus-trap on open, which schedules through rAF.
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);

const ORG = '00000000-0000-0000-0000-0000000000bb';

/** One of each role, plus a second member so "remove a peer" has a target. */
const OWNER = {
  membershipId: 'm-owner',
  role: 'owner',
  isDesigner: false,
  joinedAt: '2026-01-05T00:00:00.000Z',
  user: { id: 'u-owner', email: 'owner@example.com', name: 'Olive Owner' },
};
const ADMIN = {
  membershipId: 'm-admin',
  role: 'admin',
  isDesigner: false,
  joinedAt: '2026-02-05T00:00:00.000Z',
  user: { id: 'u-admin', email: 'admin@example.com', name: 'Adam Admin' },
};
const MEMBER = {
  membershipId: 'm-member',
  role: 'member',
  isDesigner: false,
  joinedAt: '2026-03-05T00:00:00.000Z',
  user: { id: 'u-member', email: 'member@example.com', name: 'Mia Member' },
};
const MEMBER2 = {
  membershipId: 'm-member-2',
  role: 'member',
  isDesigner: false,
  joinedAt: '2026-04-05T00:00:00.000Z',
  user: { id: 'u-member-2', email: 'ben@example.com', name: 'Ben Member' },
};
const ALL = [OWNER, ADMIN, MEMBER, MEMBER2];

/** Every request the UI makes, and what the next one answers with. */
let requested = [];
let nextResponse = null;

globalThis.fetch = async (input, init = {}) => {
  const path = String(input);
  const method = init?.method || 'GET';
  requested.push({ method, path, body: init?.body ? JSON.parse(init.body) : null });

  if (nextResponse) {
    const { status, body } = nextResponse;
    nextResponse = null;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, members: ALL, total: ALL.length }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { setFeatures } = await import('../client/lib/state/features.js');
const permissions = await import('../client/views/settings/organization-members/permissions.js');
const { renderMembersList } = await import(
  '../client/views/settings/organization-members/member-list.js'
);
const { renderOrganizationMembersPanel } = await import(
  '../client/views/settings/organization-members/panel.js'
);

setFeatures({ multiWorkspace: true });

/** The signed-in person, at a given membership role. */
const viewer = (member, role) => ({
  email: member.user.email,
  isAdmin: true,
  organizationId: ORG,
  organizationRole: role,
});

test.beforeEach(() => {
  requested = [];
  nextResponse = null;
  document.body.innerHTML = '';
});

/** Let a click's promise chain settle. */
async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Which affordances a row carries — the mirror of the route's rules
// ---------------------------------------------------------------------------

test('only the owner may change roles', () => {
  const { canChangeRole } = permissions;
  const asOwner = viewer(OWNER, 'owner');

  assert.equal(canChangeRole(MEMBER, asOwner), true);
  assert.equal(canChangeRole(ADMIN, asOwner), true);
  assert.equal(canChangeRole(OWNER, asOwner), false, 'not your own role');

  // An admin's only legal role write on the server is "set to member" *and*
  // "target is already a member" — the empty set. So an admin gets no role
  // control rather than one that can only ever no-op.
  const asAdmin = viewer(ADMIN, 'admin');
  assert.equal(canChangeRole(MEMBER, asAdmin), false);
  assert.equal(canChangeRole(MEMBER, viewer(MEMBER, 'member')), false);
});

test('removal follows the same ladder the route enforces', () => {
  const { canRemove } = permissions;

  const asOwner = viewer(OWNER, 'owner');
  assert.equal(canRemove(ADMIN, asOwner), true);
  assert.equal(canRemove(MEMBER, asOwner), true);
  assert.equal(canRemove(OWNER, asOwner), false, 'the owner leaves by transferring first');

  const asAdmin = viewer(ADMIN, 'admin');
  assert.equal(canRemove(MEMBER, asAdmin), true);
  assert.equal(canRemove(OWNER, asAdmin), false);
  assert.equal(canRemove(ADMIN, asAdmin), true, 'leaving is removing yourself');

  const asMember = viewer(MEMBER, 'member');
  assert.equal(canRemove(MEMBER, asMember), true, 'anyone but the owner may leave');
  assert.equal(canRemove(MEMBER2, asMember), false, 'but not take someone else with them');
});

test('single-workspace has no membership role, so it has no member actions', () => {
  // `organizationRole` is null outside multi-workspace (and under the dev
  // bypass). Nothing here should fall back to the instance-wide `isAdmin`,
  // which is exactly the asymmetry slice 2 removed.
  const instanceAdmin = { email: OWNER.user.email, isAdmin: true, organizationId: ORG };
  assert.equal(permissions.canChangeRole(MEMBER, instanceAdmin), false);
  assert.equal(permissions.canRemove(MEMBER, instanceAdmin), false);
  assert.equal(permissions.canTransferOwnership(MEMBER, instanceAdmin), false);
});

/** Render the list with handlers and return the container. */
function renderWith(currentUser, handlers = {}) {
  const container = document.createElement('div');
  renderMembersList(container, ALL, currentUser, {
    handlers: {
      onChangeRole: async () => true,
      onRemove: async () => true,
      onTransferOwnership: async () => true,
      ...handlers,
    },
  });
  return container;
}

/** The card for one member. */
const cardFor = (container, member) =>
  Array.from(container.querySelectorAll('.admin-user-card')).find((card) =>
    card.textContent.includes(member.user.email)
  );

test('the owner sees role, transfer and remove on other rows', () => {
  const container = renderWith(viewer(OWNER, 'owner'));
  const card = cardFor(container, MEMBER);

  assert.ok(card.querySelector('select'), 'a role control');
  const labels = Array.from(card.querySelectorAll('button')).map((b) => b.textContent);
  assert.deepEqual(labels, ['Make owner', 'Remove']);
});

test('the owner’s own row explains why it has no Leave button', () => {
  const container = renderWith(viewer(OWNER, 'owner'));
  const card = cardFor(container, OWNER);

  assert.equal(card.querySelectorAll('button').length, 0);
  assert.match(
    card.textContent,
    /Hand the organization over to someone else before you can leave it/,
    'silence would read as a missing feature; this is a rule with a way out'
  );
});

test('an admin gets Remove on members and Leave on their own row', () => {
  const container = renderWith(viewer(ADMIN, 'admin'));

  assert.deepEqual(
    Array.from(cardFor(container, MEMBER).querySelectorAll('button')).map((b) => b.textContent),
    ['Remove']
  );
  assert.equal(cardFor(container, MEMBER).querySelector('select'), null);

  assert.deepEqual(
    Array.from(cardFor(container, ADMIN).querySelectorAll('button')).map((b) => b.textContent),
    ['Leave']
  );
  assert.equal(
    cardFor(container, OWNER).querySelectorAll('button').length,
    0,
    'an admin cannot touch the owner'
  );
});

test('a plain member can only leave', () => {
  const container = renderWith(viewer(MEMBER, 'member'));

  assert.deepEqual(
    Array.from(cardFor(container, MEMBER).querySelectorAll('button')).map((b) => b.textContent),
    ['Leave']
  );
  for (const other of [OWNER, ADMIN, MEMBER2]) {
    assert.equal(cardFor(container, other).querySelectorAll('button').length, 0);
  }
});

// ---------------------------------------------------------------------------
// What the actions send, and what happens when they are refused
// ---------------------------------------------------------------------------

/** Confirm the next modal by clicking its danger button. */
async function confirmDialog() {
  await settle();
  const button = document.querySelector('.modal .btn-danger');
  assert.ok(button, 'a confirmation was shown');
  button.click();
  await settle();
}

test('changing a role PATCHes the membership', async () => {
  const panel = renderOrganizationMembersPanel({
    user: viewer(OWNER, 'owner'),
    reload: () => assert.fail('changing someone else’s role must not reload the page'),
  });
  await panel.ready;
  requested = [];

  const select = cardFor(panel.el, MEMBER).querySelector('select');
  select.value = 'admin';
  select.dispatchEvent(new dom.window.Event('change'));
  await settle();

  assert.deepEqual(requested[0], {
    method: 'PATCH',
    path: `/api/organizations/${ORG}/members/m-member`,
    body: { role: 'admin' },
  });
  assert.equal(requested[1].method, 'GET', 'and the list is re-read afterwards');
});

test('a refused role change snaps the control back instead of lying', async () => {
  const panel = renderOrganizationMembersPanel({ user: viewer(OWNER, 'owner'), reload: () => {} });
  await panel.ready;

  nextResponse = {
    status: 403,
    body: { ok: false, error: 'forbidden', message: 'Admins cannot modify other admins or owners' },
  };

  const select = cardFor(panel.el, MEMBER).querySelector('select');
  select.value = 'admin';
  select.dispatchEvent(new dom.window.Event('change'));
  await settle();

  assert.equal(select.value, 'member', 'the screen shows the role the member still has');
  assert.equal(select.disabled, false, 'and the control is usable again');
  assert.match(
    document.body.textContent,
    /Admins cannot modify other admins or owners/,
    'the server’s own sentence is more specific than anything the client could invent'
  );
});

test('removing someone else reloads the list, not the page', async () => {
  let reloaded = false;
  const panel = renderOrganizationMembersPanel({
    user: viewer(OWNER, 'owner'),
    reload: () => {
      reloaded = true;
    },
  });
  await panel.ready;
  requested = [];

  cardFor(panel.el, MEMBER)
    .querySelectorAll('button')[1]
    .click();
  await confirmDialog();

  assert.equal(requested[0].method, 'DELETE');
  assert.equal(requested[0].path, `/api/organizations/${ORG}/members/m-member`);
  assert.equal(requested[1].method, 'GET');
  assert.equal(reloaded, false, 'nothing about the viewer changed');
});

test('leaving reloads the page, because the session is now in an organization you left', async () => {
  let reloaded = false;
  const panel = renderOrganizationMembersPanel({
    user: viewer(MEMBER, 'member'),
    reload: () => {
      reloaded = true;
    },
  });
  await panel.ready;
  requested = [];

  cardFor(panel.el, MEMBER).querySelector('button').click();
  await confirmDialog();

  assert.equal(requested[0].method, 'DELETE');
  assert.equal(reloaded, true);
  assert.equal(
    requested.filter((r) => r.method === 'GET').length,
    0,
    're-reading a list you can no longer see would only produce a 403'
  );
});

test('handing the organization over reloads the page too', async () => {
  let reloaded = false;
  const panel = renderOrganizationMembersPanel({
    user: viewer(OWNER, 'owner'),
    reload: () => {
      reloaded = true;
    },
  });
  await panel.ready;
  requested = [];

  cardFor(panel.el, MEMBER).querySelectorAll('button')[0].click();
  await confirmDialog();

  assert.deepEqual(requested[0], {
    method: 'PATCH',
    path: `/api/organizations/${ORG}/members/m-member`,
    body: { role: 'owner' },
  });
  assert.equal(reloaded, true, 'every gate on this page was drawn for an owner');
});

test('a destructive action asks first, and cancelling sends nothing', async () => {
  const panel = renderOrganizationMembersPanel({ user: viewer(OWNER, 'owner'), reload: () => {} });
  await panel.ready;
  requested = [];

  cardFor(panel.el, MEMBER).querySelectorAll('button')[1].click();
  await settle();
  document.querySelector('.modal .btn-secondary').click();
  await settle();

  assert.deepEqual(requested, []);
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** A panel over `total` members, handing out pages of 25. */
function pagedPanel(total, currentUser = viewer(OWNER, 'owner')) {
  const asked = [];
  const panel = renderOrganizationMembersPanel({
    user: currentUser,
    reload: () => {},
    load: async (organizationId, { offset, limit }) => {
      asked.push({ offset, limit });
      const members = [];
      for (let i = offset; i < Math.min(offset + limit, total); i += 1) {
        members.push({
          membershipId: `m-${i}`,
          role: 'member',
          isDesigner: false,
          joinedAt: '2026-03-05T00:00:00.000Z',
          user: { id: `u-${i}`, email: `person${i}@example.com`, name: `Person ${i}` },
        });
      }
      return { members, total, offset };
    },
  });
  return { panel, asked };
}

test('a single page states its range and offers no navigation', async () => {
  const { panel } = pagedPanel(4);
  await panel.ready;

  assert.match(panel.el.textContent, /Showing 1–4 of 4 members/);
  assert.equal(panel.el.querySelectorAll('.admin-users-pager button').length, 0);
});

test('a long list pages, and the range follows', async () => {
  const { panel, asked } = pagedPanel(140);
  await panel.ready;

  // Slice 3 asked for 100 and said out loud when the list was truncated, which
  // was honest but terminal: there was no way to reach member 101.
  assert.match(panel.el.textContent, /Showing 1–25 of 140 members/);

  const [prev, next] = panel.el.querySelectorAll('.admin-users-pager button');
  assert.equal(prev.disabled, true, 'nothing before the first page');
  assert.equal(next.disabled, false);

  next.click();
  await settle();
  assert.deepEqual(asked.at(-1), { offset: 25, limit: 25 });
  assert.match(panel.el.textContent, /Showing 26–50 of 140 members/);

  panel.el.querySelectorAll('.admin-users-pager button')[0].click();
  await settle();
  assert.deepEqual(asked.at(-1), { offset: 0, limit: 25 });
});

test('the last page disables Next and still states a true range', async () => {
  const { panel } = pagedPanel(30);
  await panel.ready;

  panel.el.querySelectorAll('.admin-users-pager button')[1].click();
  await settle();

  assert.match(panel.el.textContent, /Showing 26–30 of 30 members/);
  assert.equal(panel.el.querySelectorAll('.admin-users-pager button')[1].disabled, true);
});

test('emptying the last page steps back to the one before it', async () => {
  // A removal on a page of one would otherwise leave the reader staring at an
  // empty list of a non-empty organization.
  let total = 26;
  const asked = [];
  const panel = renderOrganizationMembersPanel({
    user: viewer(OWNER, 'owner'),
    reload: () => {},
    load: async (organizationId, { offset, limit }) => {
      asked.push(offset);
      const members = [];
      for (let i = offset; i < Math.min(offset + limit, total); i += 1) {
        members.push({
          membershipId: `m-${i}`,
          role: 'member',
          isDesigner: false,
          joinedAt: '2026-03-05T00:00:00.000Z',
          user: { id: `u-${i}`, email: `person${i}@example.com`, name: `Person ${i}` },
        });
      }
      return { members, total, offset };
    },
  });
  await panel.ready;

  panel.el.querySelectorAll('.admin-users-pager button')[1].click();
  await settle();
  assert.equal(asked.at(-1), 25, 'on the last page, holding one member');

  total = 25;
  const remove = Array.from(panel.el.querySelectorAll('.admin-user-card button')).find(
    (b) => b.textContent === 'Remove'
  );
  remove.click();
  await confirmDialog();

  assert.equal(asked.at(-1), 0, 'back to a page that has something on it');
  assert.match(panel.el.textContent, /Showing 1–25 of 25 members/);
});
