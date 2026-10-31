/**
 * The Share dialog's Public tab (B342, D174).
 *
 * The tabs are named after who gets access — Team / Guests / Public — and a
 * published deck shows its newest edition's two links as equal rows on the
 * Public tab: the page (`/p/{publicationId}/{version}`) and the embed
 * (`/embed/{publicationId}/{version}`), with the iframe snippet folded
 * underneath. One language picker drives all three, and only exists when the
 * deck has more than one version. Publishing again makes the next edition
 * (T1.5). The Export dialog's HTML row links here.
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

const PUB = '0b6f0c2e-6a59-4a7e-9d2a-1f0c5e7d9a10';
const ADDR = `${PUB}/2`;

const BILINGUAL = {
  id: 'deck-1',
  title: 'Deck',
  revision: 3,
  published: {
    publicationId: PUB,
    version: 2,
    path: `/p/${PUB}/2`,
    publishedAt: '2026-10-31T10:00:00.000Z',
  },
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
  assert.ok(value('page').endsWith(`/p/${ADDR}?lang=nl`), value('page'));
  assert.ok(value('embed').endsWith(`/embed/${ADDR}?lang=nl`), value('embed'));
  assert.ok(
    value('iframe').includes(`/embed/${ADDR}?lang=nl"`),
    value('iframe'),
  );
  assert.equal(
    panel().querySelector('[data-link="sdk"]'),
    null,
    'no SDK snippet: the edition embed is a plain frame',
  );
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
  assert.ok(value('iframe').includes(`${q}"`), value('iframe'));
  assert.equal(details.open, true, 'an unfolded snippet block stays unfolded');
  handle.close();
});

test('one language version → no picker', () => {
  const handle = open(
    { ...BILINGUAL, i18n: { active: 'nl', versions: { nl: { slides: [] } } } },
    { initialTab: 'public' },
  );
  assert.equal(panel().querySelector('select'), null);
  assert.ok(value('embed').endsWith(`/embed/${ADDR}?lang=nl`));
  handle.close();
});

test('a published deck publishes its next version from the tab', async () => {
  let published = 0;
  const handle = open(BILINGUAL, {
    initialTab: 'public',
    doPublish: async () => {
      published++;
      return null;
    },
  });
  const labels = [...panel().querySelectorAll('button')].map(
    (b) => b.textContent,
  );
  assert.ok(!labels.includes('Preview and address…'), labels.join(', '));
  const btn = [...panel().querySelectorAll('button')].find(
    (b) => b.textContent === 'Publish new version',
  );
  assert.ok(btn, labels.join(', '));
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(published, 1);
  handle.close();
});

test('an unpublished deck offers Publish and no links', () => {
  const handle = open(
    { ...BILINGUAL, published: null },
    { initialTab: 'public' },
  );
  assert.equal(panel().querySelector('[data-link="page"]'), null);
  assert.ok(
    [...panel().querySelectorAll('button')].some(
      (b) => b.textContent === 'Publish',
    ),
  );
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

const { setFeatures } = await import('../client/lib/state/features.js');

test('sandbox Guests controls are disabled with the same explanation as Team', async () => {
  setFeatures({ sandboxMode: true, enableSharing: false });
  const handle = open(BILINGUAL, { initialTab: 'guests' });
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const guests = document.querySelector('[data-tab="guests"]');
    const team = document.querySelector('[data-tab="organization"]');
    assert.equal(guests.hidden, false);
    assert.equal(
      guests.querySelector('.sharing-off-note').textContent,
      team.querySelector('.sharing-off-note').textContent,
    );
    assert.equal(guests.querySelector('fieldset').disabled, true);
    const button = guests.querySelector('button');
    assert.ok(button);
    assert.equal(button.matches(':disabled'), true);
  } finally {
    handle.close();
    setFeatures(null);
  }
});

test('normal organization Guests controls remain enabled', () => {
  setFeatures({ enableSharing: true });
  const handle = open(BILINGUAL, { initialTab: 'guests' });
  try {
    const guests = document.querySelector('[data-tab="guests"]');
    assert.equal(guests.querySelector('fieldset[disabled]'), null);
    assert.equal(guests.querySelector('.sharing-off-note'), null);
    assert.equal(guests.querySelector('button').matches(':disabled'), false);
  } finally {
    handle.close();
    setFeatures(null);
  }
});
