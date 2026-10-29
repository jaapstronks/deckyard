/**
 * The Share dialog's Guests tab keeps access visible and folds the extras
 * (B744, D354).
 *
 * - The dialog opens on Guests, with a status line above the tabs: workspace
 *   visibility, working guest links, published or not.
 * - Permission, Access (for a comment link) and Expiration stay in view;
 *   Label and Password sit under "More options".
 * - Access defaults to "Anyone with the link", as the heading says.
 * - Every link row states its lifetime, "Never expires" included, and the
 *   remaining time rounds up: a fresh 7-day link reads 7d, not 6d.
 *
 * Run with: node --test tests/share-modal-guests-tab.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/deck-1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;

const { setFeatures } = await import('../client/lib/state/features.js');
const { openShareModal } =
  await import('../client/views/editor/modals/share-modal/index.js');
const { formatExpiration } =
  await import('../client/views/editor/modals/share-modal/utils.js');
const { countActiveLinks, describeShareStatus } =
  await import('../client/views/editor/modals/share-modal/share-status.js');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();

const LINKS = [
  { id: 'a', url: 'http://x/s/a', permission: 'view', expiresAt: null },
  {
    id: 'b',
    url: 'http://x/s/b',
    permission: 'comment',
    registrationMode: 'open',
    expiresAt: inFuture(7 * DAY - 1000),
  },
  {
    id: 'c',
    url: 'http://x/s/c',
    permission: 'view',
    expiresAt: new Date(Date.now() - HOUR).toISOString(),
  },
];

const tick = () => new Promise((r) => setTimeout(r, 0));

function open(extra = {}, links = LINKS) {
  document.body.innerHTML = '';
  const api = async (path) => {
    if (path.endsWith('/collaborators')) return { collaborators: [] };
    if (path.endsWith('/share-links')) return { shareLinks: links };
    return {};
  };
  return openShareModal({
    api,
    pres: { id: 'deck-1', title: 'Deck', visibility: 'private', slides: [] },
    id: 'deck-1',
    root: document.body,
    lockDocumentScroll: () => () => {},
    copyToClipboard: async () => true,
    toast: { success() {}, error() {}, info() {} },
    currentUser: { id: 'u1' },
    currentUserEmail: 'u1@example.com',
    isAdmin: false,
    isDirty: () => false,
    requestSave: async () => {},
    editorState: { refreshAll: () => {} },
    syncShareUi: () => {},
    notionAvailable: () => false,
    ...extra,
  });
}

// Sharing on, as on any instance but the sandbox (D181).
setFeatures({ enableSharing: true });
test.after(() => setFeatures(null));

const guests = () => document.querySelector('[data-tab="guests"]');

test('the dialog opens on Guests; Team stays first in the tab order', () => {
  const handle = open();
  assert.equal(guests().hidden, false);
  assert.equal(
    document.querySelector('[data-tab="organization"]').hidden,
    true,
  );
  const first = document.querySelector('.share-tabs button');
  assert.equal(first.textContent.trim(), 'Team');
  handle.close();
});

test('a status line above the tabs names visibility, links and publishing', async () => {
  const handle = open();
  await tick();
  const line = document.querySelector('.share-status-line');
  assert.ok(line, 'status line rendered');
  assert.ok(
    line.compareDocumentPosition(document.querySelector('.share-tabs')) &
      dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'the status line sits above the tabs',
  );
  // Two working links: the expired one does not count.
  assert.equal(line.textContent, 'Private · 2 guest links · Not published');
  handle.close();
});

test('label and password fold under "More options"; access stays visible', () => {
  const handle = open();
  const form = guests().querySelector('.share-create-form');
  const details = form.querySelector('details.share-more-options');
  assert.ok(details, 'a disclosure exists');
  assert.equal(details.open, false, 'folded by default');
  assert.ok(details.querySelector('.share-label-input'));
  assert.ok(details.querySelector('.share-password-input'));
  for (const cls of [
    'share-permission-select',
    'share-registration-mode-select',
    'share-expiration-select',
  ]) {
    assert.equal(
      form.querySelector(`.${cls}`).closest('details'),
      null,
      `${cls} is not folded`,
    );
  }
  handle.close();
});

test('a comment link shows Access on "Anyone with the link" by default', () => {
  const handle = open();
  const permission = guests().querySelector('.share-permission-select');
  const access = guests().querySelector('.share-registration-mode-select');
  const row = access.closest('.share-registration-mode-row');
  assert.equal(row.style.display, 'none', 'hidden for a view link');
  permission.value = 'comment';
  permission.dispatchEvent(new Event('change'));
  assert.equal(row.style.display, '');
  assert.equal(access.value, 'open');
  handle.close();
});

test('a view link is created with the defaults: Share → Create Link', async () => {
  const calls = [];
  const handle = open({
    api: async (path, opts) => {
      if (opts?.method === 'POST') {
        calls.push(opts.body);
        return { url: 'http://x/s/new' };
      }
      if (path.endsWith('/share-links')) return { shareLinks: [] };
      return { collaborators: [] };
    },
  });
  guests().querySelector('.share-form-actions button').click();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].permission, 'view');
  assert.equal(calls[0].expiresAt, null);
  handle.close();
});

test('every link row states its lifetime', async () => {
  const handle = open();
  await tick();
  const texts = [...guests().querySelectorAll('.share-link-expires')].map(
    (el) => el.textContent,
  );
  assert.deepEqual(texts, ['Never expires', 'Expires in 7d', 'Expired']);
  handle.close();
});

test('formatExpiration rounds up', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const at = (ms) => new Date(now.getTime() + ms);
  assert.equal(formatExpiration(at(7 * DAY - 1000), now), '7d');
  assert.equal(formatExpiration(at(30 * DAY - 1000), now), '30d');
  assert.equal(formatExpiration(at(24 * HOUR - 1000), now), '24h');
  assert.equal(formatExpiration(at(HOUR - 1000), now), '1h');
  assert.equal(formatExpiration(at(5 * 60 * 1000), now), '1h');
  assert.equal(formatExpiration(at(DAY + HOUR), now), '2d');
});

test('the status counts working links and leaves out what it does not know', () => {
  assert.equal(countActiveLinks(LINKS), 2);
  assert.deepEqual(
    describeShareStatus({
      visibility: 'organization',
      activeLinks: 1,
      published: true,
    }),
    ['In your organization', '1 guest link', 'Published'],
  );
  assert.deepEqual(
    describeShareStatus({
      visibility: 'private',
      activeLinks: 0,
      published: null,
    }),
    ['Private', 'No guest links'],
  );
  assert.deepEqual(
    describeShareStatus({ visibility: 'private', activeLinks: null }),
    ['Private'],
  );
});
