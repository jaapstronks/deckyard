/**
 * The organization profile screen (organization UI, slice 6).
 *
 * The route draws three levels and this screen draws the same three: any member
 * reads the organization, an admin or the owner writes it, the owner alone
 * deletes it. What these tests pin is that the screen adds no fourth rule of
 * its own and drops none of the three — the failure this whole track keeps
 * guarding against is a UI gate that is stricter or looser than the API it sits
 * on top of.
 *
 * Two behaviours get their own attention because they are the ones a reasonable
 * implementation gets wrong:
 *
 *   1. **Only changed fields are sent.** `PATCH /api/organizations/:id` treats a
 *      key's presence as intent — `'description' in body` clears the column
 *      when the value is empty — so posting the whole form would make every
 *      save a rewrite of all four fields and would quietly undo whatever
 *      someone else changed in the meantime.
 *   2. **Deleting is gated on typing the name.** The organization row is the
 *      parent of nearly every table in the schema with ON DELETE CASCADE on it,
 *      so this one click takes the organization's entire contents with it, for
 *      everyone in it. A plain "Are you sure?" is not proof that the reader
 *      knows which organization they are on.
 *
 * Run with: node --test tests/organization-profile.test.js
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

/** The organization as `GET /api/organizations/:id` hands it over. */
const ORGANIZATION = {
  id: ORG,
  name: 'Beta Works',
  slug: 'beta',
  displayName: 'Beta',
  description: 'The second organization',
  logoUrl: null,
  isDefault: false,
};

/** Every request the UI makes, and what the next one answers with. */
let requested = [];
let nextResponse = null;

globalThis.fetch = async (input, init = {}) => {
  const path = String(input);
  const method = init?.method || 'GET';
  requested.push({
    method,
    path,
    body: init?.body ? JSON.parse(init.body) : null,
  });

  if (nextResponse) {
    const { status, body } = nextResponse;
    nextResponse = null;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, organization: ORGANIZATION }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
};

const { setFeatures } = await import('../client/lib/state/features.js');
const { canEditProfile, canDeleteOrganization, isOrganizationOwner } =
  await import('../client/views/settings/organization-profile/permissions.js');
const { fetchOrganization, saveOrganizationProfile, changedFields } =
  await import('../client/views/settings/organization-profile/actions.js');
const { renderOrganizationProfilePanel } =
  await import('../client/views/settings/organization-profile/panel.js');
const { showDeleteOrganizationModal } =
  await import('../client/views/settings/organization-profile/delete-modal.js');
const { isOrganizationAdmin, canSeeMemberList, isOrganizationMember } =
  await import('../client/lib/user/organization-role.js');
const { createSettingsSidebar } =
  await import('../client/views/settings/settings-sidebar.js');

setFeatures({ multiOrganization: true });

/** The signed-in person, at a given membership role. */
const viewer = (role) => ({
  email: `${role}@example.com`,
  isAdmin: role !== 'member',
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

/** Render the panel with the loads stubbed, and hand back what tests poke at. */
async function renderPanel(
  user,
  { organization = ORGANIZATION, ...overrides } = {},
) {
  const panel = renderOrganizationProfilePanel({
    user,
    load: async () => ({
      organization,
      membership: { role: user.organizationRole },
    }),
    openDelete: () => {},
    onDeleted: () => {},
    ...overrides,
  });
  await panel.ready;
  return {
    el: panel.el,
    field: (name) => panel.el.querySelector(`[name="${name}"]`),
    status: panel.el.querySelector('.organization-profile-status'),
    save: Array.from(panel.el.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save changes',
    ),
    danger: panel.el.querySelector('.organization-danger-card'),
  };
}

// ---------------------------------------------------------------------------
// The three levels, mirrored from the route
// ---------------------------------------------------------------------------

test('writing the profile needs admin or owner; deleting needs the owner', () => {
  assert.equal(canEditProfile(viewer('owner')), true);
  assert.equal(canEditProfile(viewer('admin')), true);
  assert.equal(canEditProfile(viewer('member')), false);

  assert.equal(canDeleteOrganization(viewer('owner'), ORGANIZATION), true);
  assert.equal(canDeleteOrganization(viewer('admin'), ORGANIZATION), false);
  assert.equal(canDeleteOrganization(viewer('member'), ORGANIZATION), false);

  // No membership role at all (single-organization, dev bypass, sandbox): this
  // screen is not on it, and nothing falls back to the instance-wide flag.
  assert.equal(
    canEditProfile({ email: 'jaap@example.com', isAdmin: true }),
    false,
  );
  assert.equal(
    canDeleteOrganization(
      { email: 'jaap@example.com', isAdmin: true },
      ORGANIZATION,
    ),
    false,
  );
});

test('the default organization cannot be deleted by anyone, its owner included', () => {
  const owner = viewer('owner');
  assert.equal(
    isOrganizationOwner(owner),
    true,
    'the owner section still exists',
  );
  assert.equal(
    canDeleteOrganization(owner, { ...ORGANIZATION, isDefault: true }),
    false,
    'but the button in it does not',
  );
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

test('a plain member reads the profile and cannot touch it', async () => {
  const panel = await renderPanel(viewer('member'));

  assert.equal(panel.field('name').value, 'Beta Works');
  assert.equal(panel.field('displayName').value, 'Beta');
  assert.equal(panel.field('name').disabled, true);
  assert.equal(panel.field('description').disabled, true);
  assert.equal(panel.save, undefined, 'no button that would only ever 403');
  assert.equal(panel.danger, null);
  assert.match(
    panel.el.textContent,
    /Only an admin or the owner can change it/,
  );
});

test('an admin edits the profile but gets no owner section', async () => {
  const panel = await renderPanel(viewer('admin'));

  assert.equal(panel.field('name').disabled, false);
  assert.ok(panel.save);
  assert.equal(panel.danger, null, 'deleting is the owner’s alone');
});

test('the owner gets the danger zone, and is pointed at where transfer lives', async () => {
  const panel = await renderPanel(viewer('owner'));

  assert.ok(panel.danger, 'the owner section exists');
  const deleteBtn = Array.from(panel.danger.querySelectorAll('button')).find(
    (b) => b.textContent === 'Delete organization',
  );
  assert.ok(deleteBtn);
  // Transfer is one mutation with one implementation, and it needs a person to
  // pick — so this screen names the tab that has one rather than rebuilding it.
  assert.match(panel.danger.textContent, /Members tab/);
});

test('the owner of the default organization is told the rule instead', async () => {
  const panel = await renderPanel(viewer('owner'), {
    organization: { ...ORGANIZATION, isDefault: true },
  });

  assert.ok(panel.danger, 'the section is still there');
  assert.equal(
    Array.from(panel.danger.querySelectorAll('button')).length,
    0,
    'an affordance that is certain to be refused is worse than none',
  );
  assert.match(panel.danger.textContent, /default organization/i);
});

test('the slug is stated, not offered for editing', async () => {
  const panel = await renderPanel(viewer('owner'));
  assert.equal(panel.field('slug'), null, 'PATCH does not accept it');
  assert.match(panel.el.textContent, /Identifier: beta/);
});

test('a failed load says so instead of showing an empty form', async () => {
  const panel = renderOrganizationProfilePanel({
    user: viewer('owner'),
    load: async () => {
      throw new Error('nope');
    },
  });
  await panel.ready;
  assert.match(panel.el.textContent, /Could not load the organization/);
});

test('no active organization on the session is not an empty organization', async () => {
  const panel = renderOrganizationProfilePanel({
    user: { email: 'nobody@example.com', organizationRole: 'member' },
    load: async () => assert.fail('should not have been called'),
  });
  await panel.ready;
  assert.match(panel.el.textContent, /Could not load the organization/);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test('only the fields that changed are sent', () => {
  assert.deepEqual(
    changedFields(ORGANIZATION, { ...ORGANIZATION, name: 'Beta Ltd' }),
    {
      name: 'Beta Ltd',
    },
  );
  assert.deepEqual(changedFields(ORGANIZATION, ORGANIZATION), {});
  // An emptied field is a clear, and the route stores null for it.
  assert.deepEqual(
    changedFields(ORGANIZATION, { ...ORGANIZATION, description: '   ' }),
    {
      description: null,
    },
  );
  // `null` and `''` are the same nothing; treating them as different values
  // would make every empty field look edited on every save.
  assert.deepEqual(
    changedFields(ORGANIZATION, { ...ORGANIZATION, logoUrl: '' }),
    {},
  );
});

test('saving posts the changed field alone', async () => {
  let sent = null;
  const panel = await renderPanel(viewer('owner'), {
    save: async (args) => {
      sent = args;
      return { ...ORGANIZATION, displayName: 'Beta HQ' };
    },
  });

  panel.field('displayName').value = 'Beta HQ';
  panel.save.click();
  await settle();

  assert.deepEqual(sent, {
    organizationId: ORG,
    updates: { displayName: 'Beta HQ' },
  });
  assert.equal(panel.field('displayName').value, 'Beta HQ');
});

test('saving nothing asks the server nothing', async () => {
  const panel = await renderPanel(viewer('owner'), {
    save: async () => assert.fail('should not have been called'),
  });

  panel.save.click();
  await settle();
  assert.match(panel.status.textContent, /Nothing has changed/);
});

test('a name shorter than the route accepts never leaves the form', async () => {
  const panel = await renderPanel(viewer('owner'), {
    save: async () => assert.fail('should not have been called'),
  });

  panel.field('name').value = 'B';
  panel.save.click();
  await settle();
  assert.match(panel.status.textContent, /at least two characters/);
});

test("a refusal shows the server's own sentence, on the form", async () => {
  const panel = await renderPanel(viewer('admin'), {
    save: async () => {
      const err = new Error('Admin or owner access required');
      err.statusCode = 403;
      throw err;
    },
  });

  panel.field('name').value = 'Beta Ltd';
  panel.save.click();
  await settle();

  assert.match(panel.status.textContent, /Admin or owner access required/);
  assert.equal(panel.save.disabled, false, 'and it can be tried again');
});

test('the isDefault flag survives a save that does not carry it', async () => {
  // PATCH answers with the profile fields only. Dropping the flag here would
  // hand the owner of the default organization a Delete button the moment they
  // renamed it.
  const panel = await renderPanel(viewer('owner'), {
    organization: { ...ORGANIZATION, isDefault: true },
    save: async () => ({ ...ORGANIZATION, name: 'House Renamed' }),
  });

  panel.field('name').value = 'House Renamed';
  panel.save.click();
  await settle();

  const danger = panel.el.querySelector('.organization-danger-card');
  assert.equal(Array.from(danger.querySelectorAll('button')).length, 0);
});

test('the read is the route the profile screen is a mirror of', async () => {
  await fetchOrganization(ORG);
  assert.deepEqual(requested, [
    { method: 'GET', path: `/api/organizations/${ORG}`, body: null },
  ]);

  requested = [];
  nextResponse = {
    status: 200,
    body: { ok: true, organization: ORGANIZATION },
  };
  await saveOrganizationProfile({
    organizationId: ORG,
    updates: { name: 'Beta Ltd' },
  });
  assert.deepEqual(requested, [
    {
      method: 'PATCH',
      path: `/api/organizations/${ORG}`,
      body: { name: 'Beta Ltd' },
    },
  ]);
});

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/** Open the delete dialog and hand back the pieces the tests poke at. */
function openDeleteDialog({
  remove,
  onDeleted,
  organization = ORGANIZATION,
} = {}) {
  const modal = showDeleteOrganizationModal({
    organization,
    remove,
    onDeleted,
  });
  const scope = document.querySelector('.organization-delete-modal');
  return {
    modal,
    input: scope.querySelector('input'),
    status: scope.querySelector('.modal-status'),
    confirm: Array.from(scope.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete organization',
    ),
  };
}

test('the dialog says what is about to be destroyed', () => {
  const dialog = openDeleteDialog({ remove: async () => {} });
  const text = document.querySelector('.organization-delete-modal').textContent;
  assert.match(text, /decks/i);
  assert.match(text, /cannot be undone/i);
  assert.match(text, /Type Beta Works to confirm/);
  assert.equal(dialog.confirm.disabled, true, 'locked until the name is typed');
});

test('a near miss does not unlock it', async () => {
  const dialog = openDeleteDialog({
    remove: async () => assert.fail('should not have been called'),
  });

  for (const attempt of ['Beta', 'Beta Work', 'Beta Workss']) {
    dialog.input.value = attempt;
    dialog.input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(dialog.confirm.disabled, true, `"${attempt}" is not the name`);
  }

  // Case and stray whitespace are typing accidents, not the wrong organization.
  dialog.input.value = '  beta works ';
  dialog.input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(dialog.confirm.disabled, false);
});

test('deleting reports it and hands over to the caller', async () => {
  let deleted = null;
  let landed = false;
  const dialog = openDeleteDialog({
    remove: async (args) => {
      deleted = args;
    },
    onDeleted: () => {
      landed = true;
    },
  });

  dialog.input.value = 'Beta Works';
  dialog.input.dispatchEvent(new dom.window.Event('input'));
  dialog.confirm.click();
  await settle();

  assert.deepEqual(deleted, { organizationId: ORG });
  assert.equal(landed, true);
  assert.equal(
    document.querySelector('.organization-delete-modal'),
    null,
    'dialog closed',
  );
});

test('a refused delete stays in the dialog with the server sentence', async () => {
  const dialog = openDeleteDialog({
    remove: async () => {
      const err = new Error('The default organization cannot be deleted');
      err.statusCode = 403;
      throw err;
    },
    onDeleted: () => assert.fail('nothing was deleted'),
  });

  dialog.input.value = 'Beta Works';
  dialog.input.dispatchEvent(new dom.window.Event('input'));
  dialog.confirm.click();
  await settle();

  assert.ok(
    document.querySelector('.organization-delete-modal'),
    'the dialog stays open',
  );
  assert.match(
    dialog.status.textContent,
    /default organization cannot be deleted/i,
  );
});

test('the panel opens the dialog for the organization on screen', async () => {
  let opened = null;
  const panel = await renderPanel(viewer('owner'), {
    openDelete: (options) => {
      opened = options;
    },
  });

  Array.from(panel.danger.querySelectorAll('button'))
    .find((b) => b.textContent === 'Delete organization')
    .click();

  assert.equal(opened?.organization?.id, ORG);
  assert.equal(typeof opened?.onDeleted, 'function');
});

// ---------------------------------------------------------------------------
// The gate: where the tab lives, and where it does not exist at all
// ---------------------------------------------------------------------------

/** Sidebar entries for this user, in render order, dividers included. */
function sidebarEntries(user) {
  const sidebar = createSettingsSidebar({
    isAdmin: isOrganizationAdmin(user),
    isDesigner: false,
    canSeeMembers: canSeeMemberList(user),
    canSeeOrganization: isOrganizationMember(user),
    activeTab: 'account',
    onTabChange: () => {},
  });
  return Array.from(
    sidebar.el.querySelectorAll('[data-tab], .settings-sidebar-divider'),
  ).map((el) => el.dataset.tab || 'divider');
}

test('single-organization has no organization tab, for anyone', () => {
  const admin = { email: 'jaap@example.com', isAdmin: true };
  assert.equal(isOrganizationMember(admin), false, 'no membership to speak of');
  assert.equal(sidebarEntries(admin).includes('organization'), false);
  assert.equal(
    sidebarEntries({ email: 'a@b.c', isAdmin: false }).includes('organization'),
    false,
  );
});

test('multi-organization: an admin finds it in the Admin group, before the members', () => {
  const entries = sidebarEntries(viewer('admin'));
  assert.ok(entries.includes('organization'));
  assert.ok(
    entries.indexOf('organization') > entries.indexOf('divider'),
    'admins keep it where the people tab has always been',
  );
  assert.ok(
    entries.indexOf('organization') < entries.indexOf('users'),
    'what this organization is, then who is in it',
  );
});

test('multi-organization: a plain member gets it without an Admin heading over it', () => {
  const entries = sidebarEntries(viewer('member'));
  const divider = entries.indexOf('divider');
  assert.ok(entries.includes('organization'));
  assert.ok(
    divider === -1 || entries.indexOf('organization') < divider,
    'an "Admin" divider over someone who is not one is a lie about what they see',
  );
  assert.ok(entries.indexOf('organization') < entries.indexOf('users'));
});
