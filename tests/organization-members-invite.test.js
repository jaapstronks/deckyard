/**
 * Inviting someone into the organization, and who may reach the screen at all
 * (organization UI, slice 5).
 *
 * Two things land together here, and they are the same argument seen from two
 * sides — what the server allows should be what the screen offers:
 *
 *   - **The invite path.** `POST /api/organizations/:id/members` does two
 *     different things behind one call: an address with no account here gets
 *     one plus a setup mail; an address that already has one is simply added
 *     and hears nothing. Reporting both as "invitation sent" would leave the
 *     reader waiting for a mail that was never sent, so the outcome is derived
 *     from the response's own flags and each gets its own sentence. There is
 *     no acceptance step to model — `addMember()` sets `joined_at` at once —
 *     and no test here pretends there is.
 *   - **The gate.** Slice 2 put the whole tab behind `isWorkspaceAdmin()`.
 *     That was stricter than the rule it mirrored: the route lets any member
 *     read the list and remove themselves, so a plain member was locked out of
 *     the one screen carrying their own *Leave* button. The tab now opens to
 *     every member of the organization, and the row-level mirror from slice 4
 *     is what keeps the view limited — the same panel, asked the same
 *     question, about a weaker role.
 *
 * Run with: node --test tests/organization-members-invite.test.js
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
const ALL = [OWNER, ADMIN, MEMBER];

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
const { canInvite, invitableRoles } = await import(
  '../client/views/settings/organization-members/permissions.js'
);
const { inviteMember } = await import('../client/views/settings/organization-members/actions.js');
const { showInviteModal } = await import(
  '../client/views/settings/organization-members/invite-modal.js'
);
const { renderOrganizationMembersPanel } = await import(
  '../client/views/settings/organization-members/panel.js'
);
const { isWorkspaceAdmin, canSeeMemberList, isWorkspaceMember } = await import(
  '../client/lib/user/workspace-role.js'
);
const { createSettingsSidebar } = await import('../client/views/settings/settings-sidebar.js');

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
// Who may invite, and to what
// ---------------------------------------------------------------------------

test('inviting needs admin or owner, mirroring the route', () => {
  assert.equal(canInvite(viewer(OWNER, 'owner')), true);
  assert.equal(canInvite(viewer(ADMIN, 'admin')), true);
  assert.equal(canInvite(viewer(MEMBER, 'member')), false);
  // No membership role at all (single-workspace, dev bypass, sandbox): this
  // panel is not on screen there, and nothing falls back to `isAdmin`.
  assert.equal(canInvite({ email: OWNER.user.email, isAdmin: true }), false);
});

test('an admin may only hand out `member`, so they get no choice to make', () => {
  assert.deepEqual(invitableRoles(viewer(OWNER, 'owner')), ['member', 'admin']);
  assert.deepEqual(
    invitableRoles(viewer(ADMIN, 'admin')),
    ['member'],
    'the server refuses anything else from an admin'
  );
  assert.deepEqual(invitableRoles(viewer(MEMBER, 'member')), []);
  assert.equal(
    invitableRoles(viewer(OWNER, 'owner')).includes('owner'),
    false,
    'handing the organization over is the transfer path, not the invite path'
  );
});

test('the panel offers the button only to those who may use it', async () => {
  for (const [member, role, expected] of [
    [OWNER, 'owner', true],
    [ADMIN, 'admin', true],
    [MEMBER, 'member', false],
  ]) {
    const panel = renderOrganizationMembersPanel({
      user: viewer(member, role),
      openInvite: () => {},
    });
    await panel.ready;
    const button = Array.from(panel.el.querySelectorAll('button')).find(
      (b) => b.textContent === 'Invite'
    );
    assert.equal(Boolean(button), expected, `${role} invite button`);
  }
});

test('the invite button opens the dialog for the organization on screen', async () => {
  let opened = null;
  const panel = renderOrganizationMembersPanel({
    user: viewer(OWNER, 'owner'),
    openInvite: (options) => {
      opened = options;
    },
  });
  await panel.ready;

  Array.from(panel.el.querySelectorAll('button'))
    .find((b) => b.textContent === 'Invite')
    .click();

  assert.equal(opened?.organizationId, ORG);
  assert.equal(typeof opened?.onInvited, 'function');
});

test('a successful invite reloads the page the reader is on', async () => {
  let onInvited = null;
  const panel = renderOrganizationMembersPanel({
    user: viewer(OWNER, 'owner'),
    openInvite: (options) => {
      onInvited = options.onInvited;
    },
  });
  await panel.ready;
  Array.from(panel.el.querySelectorAll('button'))
    .find((b) => b.textContent === 'Invite')
    .click();

  requested = [];
  await onInvited();
  assert.equal(requested.length, 1, 'the list is re-read');
  assert.match(requested[0].path, /offset=0/, 'and stays on the page it was showing');
});

// ---------------------------------------------------------------------------
// What actually happened — the two outcomes the route reports
// ---------------------------------------------------------------------------

test('a new account is invited; an existing one is added and told nothing', async () => {
  nextResponse = {
    status: 201,
    body: { ok: true, member: { isNewUser: true, invitationSent: true } },
  };
  assert.equal(
    (await inviteMember({ organizationId: ORG, email: 'new@example.com' })).outcome,
    'invited'
  );

  nextResponse = {
    status: 201,
    body: { ok: true, member: { isNewUser: false, invitationSent: false } },
  };
  assert.equal(
    (await inviteMember({ organizationId: ORG, email: 'known@example.com' })).outcome,
    'added',
    'someone who already had an account here gets no mail'
  );

  // The third state is not reachable through this dialog (it never asks for
  // the mail to be skipped) but the route can produce it, and calling it an
  // invitation would send the reader waiting for a mail that never went out.
  nextResponse = {
    status: 201,
    body: { ok: true, member: { isNewUser: true, invitationSent: false } },
  };
  assert.equal(
    (await inviteMember({ organizationId: ORG, email: 'quiet@example.com' })).outcome,
    'created'
  );
});

test('the invite goes to the organization on screen, with the chosen role', async () => {
  nextResponse = {
    status: 201,
    body: { ok: true, member: { isNewUser: true, invitationSent: true } },
  };
  await inviteMember({
    organizationId: ORG,
    email: ' New@Example.com ',
    name: 'Nina New',
    role: 'admin',
  });

  const [call] = requested;
  assert.equal(call.method, 'POST');
  assert.equal(call.path, `/api/organizations/${ORG}/members`);
  assert.deepEqual(call.body, { email: ' New@Example.com ', name: 'Nina New', role: 'admin' });
});

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

/** Open the dialog and hand back the pieces the tests poke at. */
function openDialog(user, { invite, onInvited } = {}) {
  const modal = showInviteModal({
    organizationId: ORG,
    user,
    invite,
    onInvited,
  });
  return {
    modal,
    email: document.querySelector('.organization-invite-modal input[type="email"]'),
    name: document.querySelector('.organization-invite-modal input[type="text"]'),
    role: document.querySelector('.organization-invite-modal select'),
    status: document.querySelector('.organization-invite-modal .modal-status'),
    submit: Array.from(document.querySelectorAll('.organization-invite-modal button')).find(
      (b) => b.textContent === 'Send invitation'
    ),
  };
}

test('an owner picks a role; an admin is told which one they get', () => {
  const asOwner = openDialog(viewer(OWNER, 'owner'));
  assert.ok(asOwner.role, 'the owner chooses');
  assert.deepEqual(
    Array.from(asOwner.role.options).map((o) => o.value),
    ['member', 'admin']
  );
  asOwner.modal.close();
  document.body.innerHTML = '';

  const asAdmin = openDialog(viewer(ADMIN, 'admin'));
  assert.equal(asAdmin.role, null, 'a select with one option is not a choice');
  assert.match(
    document.querySelector('.organization-invite-modal').textContent,
    /join as a member/,
    'so the rule is stated instead'
  );
});

test('an address without an @ never reaches the server', async () => {
  const dialog = openDialog(viewer(OWNER, 'owner'), {
    invite: async () => assert.fail('should not have been called'),
  });
  dialog.email.value = 'nobody';
  dialog.submit.click();
  await settle();

  assert.match(dialog.status.textContent, /valid email/i);
  assert.ok(document.querySelector('.organization-invite-modal'), 'and the dialog stays open');
});

test('a refusal stays in the dialog, next to the field that caused it', async () => {
  const dialog = openDialog(viewer(OWNER, 'owner'), {
    invite: async () => {
      const err = new Error('This user is already a member of the organization');
      err.statusCode = 400;
      throw err;
    },
  });
  dialog.email.value = 'known@example.com';
  dialog.submit.click();
  await settle();

  assert.match(dialog.status.textContent, /already a member/i);
  assert.ok(document.querySelector('.organization-invite-modal'), 'the dialog stays open');
  assert.equal(dialog.submit.disabled, false, 'and can be tried again after an edit');
});

test("a role refusal shows the server's own sentence, not a guess", async () => {
  const dialog = openDialog(viewer(ADMIN, 'admin'), {
    invite: async () => {
      const err = new Error('Admins can only invite members (not admins or owners)');
      err.statusCode = 403;
      throw err;
    },
  });
  dialog.email.value = 'new@example.com';
  dialog.submit.click();
  await settle();

  assert.match(dialog.status.textContent, /Admins can only invite members/);
});

test('a success closes the dialog and reports what happened', async () => {
  let invited = null;
  const dialog = openDialog(viewer(OWNER, 'owner'), {
    invite: async () => ({ outcome: 'added', email: 'known@example.com' }),
    onInvited: (result) => {
      invited = result;
    },
  });
  dialog.email.value = 'known@example.com';
  dialog.submit.click();
  await settle();

  assert.equal(document.querySelector('.organization-invite-modal'), null, 'dialog closed');
  assert.equal(invited?.outcome, 'added');
  // The one sentence that has to survive: nobody mailed them.
  assert.match(document.body.textContent, /not emailed/i);
});

// ---------------------------------------------------------------------------
// The gate: the member list is not an admin surface
// ---------------------------------------------------------------------------

/** Tab keys the sidebar renders for this user. */
function visibleTabKeys(user) {
  const sidebar = createSettingsSidebar({
    isAdmin: isWorkspaceAdmin(user),
    isDesigner: false,
    canSeeMembers: canSeeMemberList(user),
    activeTab: 'account',
    onTabChange: () => {},
  });
  return Array.from(sidebar.el.querySelectorAll('[data-tab]')).map((b) => b.dataset.tab);
}

test('single-workspace is untouched: the tab is the admin tab it always was', () => {
  const admin = { email: 'jaap@example.com', isAdmin: true };
  const plain = { email: 'someone@example.com', isAdmin: false };

  assert.equal(isWorkspaceMember(admin), false, 'no membership to speak of');
  assert.equal(canSeeMemberList(admin), true);
  assert.equal(canSeeMemberList(plain), false, 'and no back door into it');
  assert.ok(visibleTabKeys(admin).includes('users'));
  assert.equal(visibleTabKeys(plain).includes('users'), false);
});

test('multi-workspace: a plain member reaches the member list, and nothing else', () => {
  const member = viewer(MEMBER, 'member');

  assert.equal(isWorkspaceAdmin(member), false, 'still not an admin anywhere on this page');
  assert.equal(canSeeMemberList(member), true);

  const tabs = visibleTabKeys(member);
  assert.ok(tabs.includes('users'), 'the screen with their own Leave button');
  for (const adminTab of ['admin', 'api-keys', 'email', 'integrations', 'analytics']) {
    assert.equal(tabs.includes(adminTab), false, `${adminTab} stays behind the admin gate`);
  }
});

test('an organization owner who is not an instance admin gets it too', () => {
  // The members route checks the membership and nothing else, so this person
  // may genuinely manage the list — slice 2's gate hid it from them entirely.
  const orgOwner = { email: OWNER.user.email, isAdmin: false, organizationRole: 'owner' };
  assert.equal(canSeeMemberList(orgOwner), true);
  assert.ok(visibleTabKeys(orgOwner).includes('users'));
  assert.equal(canInvite(orgOwner), true);
});
