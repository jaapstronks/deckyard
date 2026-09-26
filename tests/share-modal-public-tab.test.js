/**
 * The Share dialog's Public tab (B342, D174).
 *
 * The tabs are named after who gets access — Team / Guests / Public — and a
 * published deck shows its two links as equal rows on the Public tab: the page
 * (`/p/…`) and the embed (`/embed/…`), with the iframe/SDK snippets folded
 * underneath. One language picker drives all four, and only exists when the
 * deck has more than one version. The Export dialog's HTML row links here.
 *
 * Run with: node --test tests/share-modal-public-tab.test.js
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

const { openShareModal } =
  await import('../client/views/editor/modals/share-modal/index.js');
const { openExportModal } =
  await import('../client/views/editor/export-modal.js');

const BILINGUAL = {
  id: 'deck-1',
  title: 'Deck',
  published: { id: 'ab12cd34', slug: 'deck' },
  i18n: {
    active: 'nl',
    versions: { nl: { slides: [] }, 'en-GB': { slides: [] } },
  },
  slides: [{ type: 'title' }],
};

async function fakeApi(path) {
  if (path.endsWith('/collaborators')) return { collaborators: [] };
  if (path.includes('/share-links')) return { links: [] };
  return {};
}

function open(pres, extra = {}) {
  document.body.innerHTML = '';
  return openShareModal({
    api: fakeApi,
    pres,
    id: pres.id,
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

const panel = () => document.querySelector('[data-tab="public"]');
const value = (kind) =>
  panel().querySelector(
    `[data-link="${kind}"] input, [data-link="${kind}"] textarea`,
  ).value;

test('the tabs are named after the audience: Team, Guests, Public', () => {
  const handle = open(BILINGUAL);
  const labels = [...document.querySelectorAll('.share-tabs button')].map((b) =>
    b.textContent.trim(),
  );
  assert.deepEqual(labels, ['Team', 'Guests', 'Public']);
  handle.close();
});

test('initialTab "public" opens on the Public panel', () => {
  const handle = open(BILINGUAL, { initialTab: 'public' });
  assert.equal(panel().hidden, false);
  assert.equal(
    document.querySelector('[data-tab="organization"]').hidden,
    true,
  );
  handle.close();
});

test('a published deck shows Link and Embed as two different URLs', () => {
  const handle = open(BILINGUAL, { initialTab: 'public' });
  assert.match(value('page'), /\/p\/ab12cd34-deck\?lang=nl$/);
  assert.match(value('embed'), /\/embed\/ab12cd34-deck\?lang=nl$/);
  assert.match(
    value('iframe'),
    /<iframe src="[^"]*\/embed\/ab12cd34-deck\?lang=nl&/,
  );
  assert.match(value('sdk'), /lang: 'nl'/);
  assert.ok(
    panel().querySelector('details.share-publish-snippets'),
    'the snippets fold out underneath',
  );
  handle.close();
});

test('one language picker drives both URLs and the snippets', () => {
  const handle = open(BILINGUAL, { initialTab: 'public' });
  const select = panel().querySelector('select');
  assert.ok(select, 'two versions → a picker');
  const details = panel().querySelector('details.share-publish-snippets');
  details.open = true;

  const other = [...select.options].map((o) => o.value).find((v) => v !== 'nl');
  select.value = other;
  select.dispatchEvent(new Event('change'));

  const q = `?lang=${encodeURIComponent(other)}`;
  assert.ok(value('page').endsWith(q), value('page'));
  assert.ok(value('embed').endsWith(q), value('embed'));
  assert.ok(value('iframe').includes(`${q}&`), value('iframe'));
  assert.ok(value('sdk').includes(`lang: '${other}'`));
  assert.equal(details.open, true, 'an unfolded snippet block stays unfolded');
  handle.close();
});

test('one language version → no picker', () => {
  const handle = open(
    { ...BILINGUAL, i18n: { active: 'nl', versions: { nl: { slides: [] } } } },
    { initialTab: 'public' },
  );
  assert.equal(panel().querySelector('select'), null);
  assert.match(value('embed'), /\/embed\/ab12cd34-deck\?lang=nl$/);
  handle.close();
});

test('"Preview and address…" replaces "Manage published…"', () => {
  let opened = 0;
  const handle = open(BILINGUAL, {
    initialTab: 'public',
    openPreviewAddress: () => opened++,
  });
  const btn = [...panel().querySelectorAll('button')].find(
    (b) => b.textContent === 'Preview and address…',
  );
  assert.ok(btn);
  btn.click();
  assert.equal(opened, 1);
  handle.close();
});

test("the Export dialog's HTML hint opens the Public tab", () => {
  document.body.innerHTML = '';
  let calls = 0;
  const modal = openExportModal({
    pres: BILINGUAL,
    id: BILINGUAL.id,
    root: document.body,
    openPublic: () => calls++,
  });
  const link = document.querySelector('.export-format-hint .link-button');
  assert.ok(link, 'the HTML row carries a link, not a bare sentence');
  link.click();
  assert.equal(calls, 1);
  assert.equal(document.querySelector('.export-modal'), null, 'export closes');
  modal.close?.();
});

test('without a Public tab to open, the Export dialog shows no hint', () => {
  document.body.innerHTML = '';
  const modal = openExportModal({
    pres: BILINGUAL,
    id: BILINGUAL.id,
    root: document.body,
  });
  assert.equal(document.querySelector('.export-format-hint'), null);
  modal.close();
});
