/**
 * Organization switcher in the user menu (multi-workspace slice 1).
 *
 * The load-bearing assertion is the first one: on a single-workspace instance
 * the section must not exist *and* must not cost a request. `/api/organizations`
 * is behind the same feature flag on the server, so asking would earn a 403 on
 * every page render — the switcher has to decide from `features.multiWorkspace`
 * alone, before any network.
 *
 * The rest pins the switch behaviour: a full reload on success (never a partial
 * cache refresh, which would leave the previous organization's data on screen),
 * and a readable toast instead of a raw error when the switch is refused.
 *
 * Run with: node --test tests/organization-switcher.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
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
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;

// Record every request the UI makes so the single-org case can be proven quiet.
const requested = [];
globalThis.fetch = async (input, init = {}) => {
  requested.push(`${init?.method || 'GET'} ${String(input)}`);
  return new dom.window.Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { setFeatures } = await import('../client/lib/state/features.js');
const { createUserMenu } = await import('../client/lib/user/user-menu.js');
const { createOrganizationSection } = await import(
  '../client/lib/user/organization-switcher.js'
);

const ORGS = [
  { id: 'org-a', name: 'Alpha', membership: { role: 'owner' } },
  { id: 'org-b', name: 'Beta', membership: { role: 'member' } },
];

/** Let the section's load promise and its `.then` chain settle. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function orgRows(el) {
  return Array.from(el.querySelectorAll('.user-menu-org'));
}

test('single workspace: no organization section and no /api/organizations request', async () => {
  setFeatures({ multiWorkspace: false });
  requested.length = 0;

  const menu = createUserMenu({
    user: { email: 'jaap@example.com', name: 'Jaap', organizationId: 'org-a' },
    nav: () => {},
  });
  document.body.append(menu.el);
  await settle();

  assert.equal(
    menu.el.querySelector('.user-menu-orgs'),
    null,
    'no organization section is rendered'
  );
  assert.deepEqual(
    requested.filter((r) => r.includes('/api/organizations')),
    [],
    'the organization list is never requested in single-workspace mode'
  );

  menu.detach();
  menu.el.remove();
});

test('multi-workspace with a single organization: section renders nothing', async () => {
  setFeatures({ multiWorkspace: true });

  const section = createOrganizationSection({
    activeOrganizationId: 'org-a',
    load: async () => [ORGS[0]],
  });
  assert.ok(section, 'section is created when the feature is on');
  await section.ready;

  assert.equal(orgRows(section.el).length, 0, 'one organization is not a choice');
  assert.equal(section.el.textContent, '', 'nothing is shown at all');
});

test('two organizations: both listed, the active one checked', async () => {
  setFeatures({ multiWorkspace: true });

  const section = createOrganizationSection({
    activeOrganizationId: 'org-a',
    load: async () => ORGS,
  });
  await section.ready;

  const rows = orgRows(section.el);
  assert.equal(rows.length, 2, 'one row per organization');
  assert.deepEqual(
    rows.map((r) => r.dataset.organizationId),
    ['org-a', 'org-b']
  );
  assert.equal(rows[0].getAttribute('aria-checked'), 'true', 'active org is checked');
  assert.equal(rows[1].getAttribute('aria-checked'), 'false');
  assert.equal(rows[0].disabled, false, 'the active row keeps full contrast');
  assert.match(rows[1].textContent, /Beta/);

  // `radio` inside `radiogroup`, not `menuitemradio`: this dropdown has no
  // `menu` ancestor, and a menu role would promise arrow-key navigation that
  // nothing here implements.
  assert.equal(section.el.getAttribute('role'), 'radiogroup');
  assert.deepEqual(
    rows.map((r) => r.getAttribute('role')),
    ['radio', 'radio']
  );

  // Both rows carry the fixed-width check slot — the empty one on the inactive
  // row is what keeps the two labels starting on the same x.
  assert.equal(
    section.el.querySelectorAll('.user-menu-org-check').length,
    2,
    'every row has the check slot, filled or not'
  );
  assert.equal(rows[1].querySelector('.user-menu-org-check').textContent, '');
});

test('clicking the organization you are already in does nothing', async () => {
  setFeatures({ multiWorkspace: true });

  let switches = 0;
  let reloads = 0;
  const section = createOrganizationSection({
    activeOrganizationId: 'org-a',
    load: async () => ORGS,
    switchTo: async () => {
      switches += 1;
    },
    reload: () => {
      reloads += 1;
    },
  });
  await section.ready;

  orgRows(section.el)[0].click();
  await settle();

  assert.equal(switches, 0, 'no switch request');
  assert.equal(reloads, 0, 'no pointless reload');
});

test('a successful switch posts, then reloads the whole page', async () => {
  setFeatures({ multiWorkspace: true });

  const switched = [];
  let reloads = 0;
  let closed = 0;
  const section = createOrganizationSection({
    activeOrganizationId: 'org-a',
    load: async () => ORGS,
    switchTo: async (id) => {
      switched.push(id);
    },
    reload: () => {
      reloads += 1;
    },
    onBeforeSwitch: () => {
      closed += 1;
    },
  });
  await section.ready;

  orgRows(section.el)[1].click();
  await settle();

  assert.deepEqual(switched, ['org-b'], 'switch request targets the clicked org');
  assert.equal(closed, 1, 'the dropdown is closed before switching');
  assert.equal(reloads, 1, 'a full reload follows — no partial cache refresh');
});

test('a refused switch shows a toast and leaves the page where it is', async () => {
  setFeatures({ multiWorkspace: true });
  document.querySelector('.toast-stack')?.remove();

  let reloads = 0;
  const section = createOrganizationSection({
    activeOrganizationId: 'org-a',
    load: async () => ORGS,
    switchTo: async () => {
      const err = new Error('Multi-workspace features are not enabled');
      err.statusCode = 403;
      throw err;
    },
    reload: () => {
      reloads += 1;
    },
  });
  await section.ready;

  orgRows(section.el)[1].click();
  await settle();

  assert.equal(reloads, 0, 'a failed switch must not reload');
  const stack = document.querySelector('.toast-stack');
  assert.ok(stack, 'a toast is shown');
  assert.match(
    stack.textContent,
    /cannot switch to this organization/i,
    'the 403 reads as a permission message, not an unknown error'
  );
});

test('a list that fails to load hides the section instead of erroring', async () => {
  setFeatures({ multiWorkspace: true });

  const warn = console.warn;
  console.warn = () => {}; // the failure is logged on purpose; keep test output clean
  const section = createOrganizationSection({
    activeOrganizationId: 'org-a',
    load: async () => {
      throw new Error('boom');
    },
  });
  await section.ready;
  console.warn = warn;

  assert.equal(orgRows(section.el).length, 0);
  assert.equal(section.el.textContent, '');
});
