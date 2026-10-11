/**
 * The settings page and its sidebar read one tab register (B679).
 *
 * Before B679 `client/views/settings/index.js` and `settings-sidebar.js` each
 * declared their own `ADMIN_TABS`, six entries against eight: the page gated
 * and built from one, the sidebar drew from the other, and nothing held them
 * together. What this pins down:
 *
 *   - Neither file names a tab: no tab-key literal outside tab-registry.js.
 *   - Per viewer, the panels the page builds and the buttons the sidebar draws
 *     are the same keys, in the same order, and the expected ones: the role
 *     gate per tab, including the two organization tabs whose gate is wider
 *     than admin and the API keys tab that follows its installation feature.
 *   - A hash for a tab the viewer may not reach lands on the default.
 *
 * Run with: node --test tests/settings-tab-registry.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/settings',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.history = dom.window.history;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
// The active tab loads on mount; these tests look at structure, not data, so
// every request stays pending.
globalThis.fetch = () => new Promise(() => {});
globalThis.EventSource = class {
  close() {}
  addEventListener() {}
};

const { setFeatures } = await import('../client/lib/state/features.js');
const { renderSettings } = await import('../client/views/settings/index.js');
const { SETTINGS_TABS, DEFAULT_TAB } =
  await import('../client/views/settings/tab-registry.js');

const PERSONAL = ['account', 'preferences', 'export'];
const DESIGNER = ['fonts', 'themes', 'slide-types'];
const ADMIN = [
  'admin',
  'users',
  'api-keys',
  'email',
  'integrations',
  'analytics',
  'health',
];

/** Render the page for `user` and read both lists off the DOM. */
async function renderFor(user, hash = '') {
  document.body.innerHTML = '';
  window.location.hash = hash;
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = await renderSettings(root, { user });
  const panels = [
    ...root.querySelectorAll('.settings-content > .settings-tab-view'),
  ].map((el) => el.id.replace(/^settings-tab-/, ''));
  const buttons = [
    ...root.querySelectorAll('.settings-sidebar [data-tab]'),
  ].map((el) => el.dataset.tab);
  const active = root.querySelector('.settings-content > .is-active');
  cleanup?.();
  return {
    panels,
    buttons,
    active: active?.id.replace(/^settings-tab-/, ''),
  };
}

/** Both lists, compared as sets: the page builds panels in its own order. */
function assertSameTabs({ panels, buttons }, expected, message) {
  assert.deepEqual(buttons, expected, `${message}: the sidebar`);
  assert.deepEqual(
    [...panels].sort(),
    [...expected].sort(),
    `${message}: the page`,
  );
}

const ORG = 'org-1';
const member = (role) => ({
  email: `${role}@example.com`,
  isAdmin: role !== 'member',
  organizationId: ORG,
  organizationRole: role,
});

test.beforeEach(() => {
  setFeatures({ enablePublicApi: true, multiOrganization: false });
});

test('neither the page nor the sidebar names a tab of its own', () => {
  const keys = SETTINGS_TABS.map((tab) => tab.key);
  for (const file of [
    'client/views/settings/index.js',
    'client/views/settings/settings-sidebar.js',
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const named = keys.filter((key) =>
      new RegExp(`['"\`]${key}['"\`]`).test(source),
    );
    assert.deepEqual(named, [], `${file} declares tab keys: ${named}`);
  }
});

test('a plain user reaches the personal tabs only', async () => {
  const seen = await renderFor({ email: 'a@example.com', isAdmin: false });
  assertSameTabs(seen, PERSONAL, 'plain user');
});

test('a designer adds the designer tabs', async () => {
  const seen = await renderFor({
    email: 'd@example.com',
    isAdmin: false,
    isDesigner: true,
  });
  assertSameTabs(seen, [...PERSONAL, ...DESIGNER], 'designer');
});

test('a single-workspace admin reaches every admin tab, no organization tab', async () => {
  const seen = await renderFor({ email: 'jaap@example.com', isAdmin: true });
  assertSameTabs(seen, [...PERSONAL, ...ADMIN], 'admin');
});

test('without the public API cluster the API keys tab is absent (D260)', async () => {
  setFeatures({ enablePublicApi: false });
  const seen = await renderFor({ email: 'jaap@example.com', isAdmin: true });
  assertSameTabs(
    seen,
    [...PERSONAL, ...ADMIN.filter((key) => key !== 'api-keys')],
    'admin without public API',
  );
});

test('a multi-workspace admin finds the organization before its members', async () => {
  setFeatures({ enablePublicApi: true, multiOrganization: true });
  const seen = await renderFor(member('admin'));
  assertSameTabs(
    seen,
    [...PERSONAL, 'admin', 'organization', ...ADMIN.slice(1)],
    'organization admin',
  );
});

test('a multi-workspace member gets the organization tabs with the personal ones', async () => {
  setFeatures({ enablePublicApi: true, multiOrganization: true });
  const seen = await renderFor(member('member'));
  assertSameTabs(
    seen,
    [...PERSONAL, 'organization', 'users'],
    'organization member',
  );
});

test('a hash for a tab out of reach lands on the default', async () => {
  const plain = { email: 'a@example.com', isAdmin: false };
  for (const hash of ['health', 'users', 'fonts', 'organization', 'nope']) {
    const seen = await renderFor(plain, hash);
    assert.equal(seen.active, DEFAULT_TAB, `#${hash}`);
  }
  setFeatures({ enablePublicApi: false });
  const admin = await renderFor(
    { email: 'j@example.com', isAdmin: true },
    'api-keys',
  );
  assert.equal(admin.active, DEFAULT_TAB, '#api-keys without the cluster');
  const health = await renderFor(
    { email: 'j@example.com', isAdmin: true },
    'health',
  );
  assert.equal(health.active, 'health', 'a reachable hash is honoured');
});
