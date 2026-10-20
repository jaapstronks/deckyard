/**
 * Settings navigation is a nav of real links with history (B805).
 *
 * The sidebar used to be a tablist of buttons whose clicks replaced the hash,
 * so Back never walked through sections, and on a phone it became a
 * horizontal strip several screens wide. What this pins down:
 *
 *   - the sidebar is a labelled `<nav>` of `<a href="#key">` links with
 *     `aria-current`, and no tab roles anywhere in the settings views;
 *   - the narrow-screen opener is the only extra control, names the current
 *     section, and Escape folds it back with focus on the opener;
 *   - a plain click is the page's to handle, a modified click the browser's;
 *   - `pushHash` adds a history entry, `replaceHash` does not, and the router
 *     leaves a hash-only history step to the view instead of re-mounting it;
 *   - the unsaved-changes tracker reports, keeps and restores form state.
 *
 * Run with: node --test tests/settings-navigation.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { walkFiles } from './helpers/walk-files.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/settings#account',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;

const { createSettingsSidebar } =
  await import('../client/views/settings/settings-sidebar.js');
const { createUnsavedTracker } =
  await import('../client/views/settings/unsaved-changes.js');
const router = await import('../client/lib/state/router.js');
const { setFeatures } = await import('../client/lib/state/features.js');

setFeatures({ enablePublicApi: true });

function sidebarFor(onNavigate = () => {}) {
  const sidebar = createSettingsSidebar({
    isAdmin: true,
    isInstanceAdmin: true,
    isDesigner: true,
    canSeeMembers: true,
    canSeeOrganization: false,
    activeTab: 'account',
    onNavigate,
  });
  document.body.replaceChildren(sidebar.el);
  return sidebar;
}

test('the sidebar is a labelled nav of real links with aria-current', () => {
  const sidebar = sidebarFor();
  const nav = sidebar.el;
  assert.equal(nav.tagName, 'NAV');
  assert.ok(nav.getAttribute('aria-label'));
  assert.equal(nav.querySelector('[role]'), null, 'no tab roles');
  const links = [...nav.querySelectorAll('a[data-tab]')];
  assert.equal(links.length, 14, 'every registered section for a full admin');
  for (const link of links) {
    assert.equal(link.getAttribute('href'), `#${link.dataset.tab}`);
  }
  assert.deepEqual(
    links
      .filter((l) => l.getAttribute('aria-current'))
      .map((l) => l.dataset.tab),
    ['account'],
  );
  sidebar.setActiveTab('email');
  assert.deepEqual(
    links
      .filter((l) => l.getAttribute('aria-current') === 'page')
      .map((l) => l.dataset.tab),
    ['email'],
  );
  sidebar.detach();
});

test('the only control besides the links is the opener naming the section', () => {
  const sidebar = sidebarFor();
  const buttons = sidebar.el.querySelectorAll('button');
  assert.equal(buttons.length, 1);
  const toggle = buttons[0];
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(
    sidebar.el.querySelector(`#${toggle.getAttribute('aria-controls')}`),
    'the opener controls the section list',
  );
  assert.match(toggle.textContent, /Account/);
  sidebar.setActiveTab('fonts');
  assert.match(toggle.textContent, /Fonts/);

  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const link = sidebar.el.querySelector('a[data-tab="themes"]');
  link.focus();
  link.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, toggle, 'Escape returns focus');
  sidebar.detach();
});

test('a plain click goes to the page; a modified click to the browser', () => {
  const seen = [];
  const sidebar = sidebarFor((key) => seen.push(key));
  const link = sidebar.el.querySelector('a[data-tab="email"]');

  const plain = new dom.window.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  link.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, true);
  assert.deepEqual(seen, ['email']);

  const modified = new dom.window.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    metaKey: true,
  });
  link.dispatchEvent(modified);
  assert.equal(modified.defaultPrevented, false);
  assert.deepEqual(seen, ['email'], 'a new-tab click is not a section switch');
  sidebar.detach();
});

test('pushHash adds a history entry; replaceHash corrects in place', () => {
  const before = history.length;
  router.pushHash('email');
  assert.equal(router.currentHash(), 'email');
  assert.equal(history.length, before + 1);
  router.replaceHash('account');
  assert.equal(router.currentHash(), 'account');
  assert.equal(history.length, before + 1);
  router.pushHash('account');
  assert.equal(history.length, before + 1, 'the current hash is a no-op');
});

test('a hash-only history step does not re-mount the view', () => {
  let renders = 0;
  router.setRenderer(() => {
    renders++;
  });
  router.startRouter();
  router.pushHash('themes');
  window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert.equal(renders, 0, 'same path and query: the view follows the hash');
  history.pushState(null, '', '/app');
  window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert.equal(renders, 1, 'another page re-routes');
});

test('the unsaved tracker reports, keeps and restores the form', () => {
  const input = document.createElement('input');
  const root = document.createElement('div');
  root.append(input);
  input.value = 'saved';
  const tracker = createUnsavedTracker({
    root,
    read: () => input.value,
    write: (value) => {
      input.value = value;
    },
  });
  assert.equal(tracker.isDirty(), false);
  input.value = 'edited';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(tracker.isDirty(), true);
  assert.ok(tracker.statusEl.textContent, 'the status line says so');
  tracker.discard();
  assert.equal(input.value, 'saved');
  assert.equal(tracker.statusEl.textContent, '');
  input.value = 'kept';
  tracker.markSaved();
  assert.equal(tracker.isDirty(), false);
});

test('no settings view keeps the old tab contract', () => {
  const dir = path.join(repoRoot, 'client/views/settings');
  const offenders = [];
  for (const file of walkFiles(dir, { extensions: ['.js'] })) {
    const src = fs.readFileSync(file, 'utf8');
    if (/role: '(tablist|tab|tabpanel)'|aria-selected/.test(src)) {
      offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});
