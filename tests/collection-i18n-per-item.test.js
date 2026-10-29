/**
 * Removing or reordering items in a collection keeps every language version
 * matched per item, not per position (DY-773).
 *
 * The save-time sync (`syncStructureInto`) matches the items of two language
 * versions by index and lets the active version decide the count. Removing
 * NL item 4 of 8 therefore left EN with its items 1-7: "April" stayed, the
 * last item fell off, and every EN text after the gap belonged to the next
 * NL item. A reorder in NL never reached EN at all. A remove, move or swap
 * is now mirrored into the other versions when it happens
 * (`client/lib/slide-authoring/collection-mirror.js`), so the positions agree
 * again before the sync runs.
 *
 * The first test drives the real collection editor (the Fields panel's
 * remove button) and then a real save; the others go through the mirror and
 * the save manager, the way the editor's surfaces call them.
 *
 * Run with: node --test tests/collection-i18n-per-item.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/p1',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { normalizeLang } = await import('../shared/i18n-utils.js');
const { createSaveManager } =
  await import('../client/views/editor/save-manager.js');
const { createCollectionEditor } =
  await import('../client/views/editor/editor-form/collection-editor.js');
const { mirrorCollectionOp } =
  await import('../client/lib/slide-authoring/collection-mirror.js');

const noopToast = { info: () => {}, error: () => {}, success: () => {} };

const NL = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug'];
const EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

/** A timeline slide whose item `i` reads `<month> <lang>` in every field. */
function timeline(months, lang) {
  return {
    id: 'tl',
    type: 'timeline-slide',
    notes: '',
    content: {
      title: lang === 'nl' ? 'Tijdlijn' : 'Timeline',
      items: months.map((m) => ({
        date: m,
        title: `${m} ${lang} title`,
        text: `${m} ${lang} text`,
      })),
    },
  };
}

function bilingualDeck() {
  const nl = [timeline(NL, 'nl')];
  return {
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: nl,
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: 'Deck', slides: nl },
        en: { title: 'Deck', slides: [timeline(EN, 'en')] },
      },
    },
  };
}

function makeManager(pres) {
  return createSaveManager({
    api: async (_path, opts) => ({
      ...JSON.parse(opts.body),
      revision: Number(opts.headers['If-Match']) + 1,
      modified: 'x',
    }),
    toast: noopToast,
    pres,
    id: pres.id,
    SLIDE_TYPES,
    normalizeLang,
    getSelectedSlideId: () => 'tl',
  });
}

async function save(mgr) {
  mgr.markDirty({ slideId: 'tl' });
  await mgr.requestSave();
  mgr.cancelAutosave();
}

const items = (pres, lang) => pres.i18n.versions[lang].slides[0].content.items;

/** Each EN item's date, next to the NL item at the same index. */
const pairs = (pres) =>
  items(pres, 'nl').map((it, i) => [it.date, items(pres, 'en')[i]?.date]);

const MONTH_PAIRS = Object.fromEntries(NL.map((m, i) => [m, EN[i]]));

function assertPairedPerItem(pres) {
  for (const [nl, en] of pairs(pres)) {
    assert.equal(en, MONTH_PAIRS[nl], `NL ${nl} sits next to EN ${en}`);
  }
  assert.equal(items(pres, 'en').length, items(pres, 'nl').length);
}

test('the Fields panel: removing a middle NL item removes the same EN item', async () => {
  const pres = bilingualDeck();
  const mgr = makeManager(pres);
  const slide = pres.slides[0];
  const field = SLIDE_TYPES['timeline-slide'].fields.find(
    (f) => f.key === 'items',
  );
  const editor = createCollectionEditor({
    slide,
    def: SLIDE_TYPES['timeline-slide'],
    field,
    fieldRenderers: {},
    pres,
    markDirty: () => {},
  });
  document.body.append(editor);

  // Item 4 of 8, "Apr", by its remove button.
  editor.querySelectorAll('.card-remove-btn')[3].click();
  await save(mgr);

  assert.deepEqual(
    items(pres, 'nl').map((it) => it.date),
    ['Jan', 'Feb', 'Mrt', 'Mei', 'Jun', 'Jul', 'Aug'],
  );
  assertPairedPerItem(pres);
  assert.equal(items(pres, 'en')[3].title, 'May en title', 'EN keeps May');
  editor.remove();
});

test('reordering NL moves the same EN item', async () => {
  const pres = bilingualDeck();
  const mgr = makeManager(pres);
  const nl = pres.slides[0].content;

  // NL item 1 dragged below item 2, as the collection editor commits it.
  const next = nl.items.slice();
  const [moved] = next.splice(0, 1);
  next.splice(1, 0, moved);
  mirrorCollectionOp(pres, 'tl', ['items'], { kind: 'move', from: 0, to: 1 });
  nl.items = next;
  await save(mgr);

  assert.equal(items(pres, 'nl')[0].date, 'Feb');
  assert.equal(items(pres, 'en')[0].date, 'Feb', 'EN starts with February');
  assertPairedPerItem(pres);
});

test('a remove then a move in one save window still pairs every item', async () => {
  const pres = bilingualDeck();
  const mgr = makeManager(pres);
  const nl = pres.slides[0].content;

  nl.items.splice(3, 1);
  mirrorCollectionOp(pres, 'tl', ['items'], { kind: 'remove', index: 3 });
  const [last] = nl.items.splice(6, 1);
  nl.items.splice(0, 0, last);
  mirrorCollectionOp(pres, 'tl', ['items'], { kind: 'move', from: 6, to: 0 });
  await save(mgr);

  assert.equal(items(pres, 'nl')[0].date, 'Aug');
  assertPairedPerItem(pres);
});

test('an item added since the last save, then moved, arrives empty at its new place', async () => {
  const pres = bilingualDeck();
  const mgr = makeManager(pres);
  const nl = pres.slides[0].content;

  // Added at the end (no EN counterpart yet), then moved to the front.
  nl.items.push({ date: 'Sep', title: 'Sep nl title', text: '' });
  const [added] = nl.items.splice(8, 1);
  nl.items.splice(0, 0, added);
  mirrorCollectionOp(pres, 'tl', ['items'], { kind: 'move', from: 8, to: 0 });
  await save(mgr);

  const en = items(pres, 'en');
  assert.equal(en.length, 9);
  // The save normalization drops empty strings, so "no text" is a missing key.
  assert.equal(en[0].title ?? '', '', 'the new item has no English text yet');
  assert.equal(en[0].date ?? '', '', 'and no Dutch text either');
  assert.equal(en[1].date, 'Jan', 'January follows it, as in NL');
  assert.equal(en[8].date, 'Aug');
});

test('a nested collection follows on its own path', async () => {
  const blocksSlide = (lang) => ({
    id: 'tb',
    type: 'text-blocks-slide',
    notes: '',
    content: {
      title: lang,
      rows: [
        {
          title: `row ${lang}`,
          blocks: ['A', 'B', 'C'].map((b) => ({
            title: `${b} ${lang}`,
            body: '',
          })),
        },
      ],
    },
  });
  const nlSlides = [blocksSlide('nl')];
  const pres = {
    id: 'p2',
    title: 'Deck',
    revision: 1,
    slides: nlSlides,
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: 'Deck', slides: nlSlides },
        en: { title: 'Deck', slides: [blocksSlide('en')] },
      },
    },
  };
  const mgr = makeManager(pres);
  pres.slides[0].content.rows[0].blocks.splice(0, 1);
  mirrorCollectionOp(pres, 'tb', ['rows', 0, 'blocks'], {
    kind: 'remove',
    index: 0,
  });
  mgr.markDirty({ slideId: 'tb' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  const en = pres.i18n.versions.en.slides[0].content.rows[0].blocks;
  assert.deepEqual(
    en.map((b) => b.title),
    ['B en', 'C en'],
  );
});

test('the mirror leaves the active buffer, a one-version deck and a missing slide alone', () => {
  const pres = bilingualDeck();
  mirrorCollectionOp(pres, 'tl', ['items'], { kind: 'remove', index: 0 });
  assert.equal(items(pres, 'nl').length, 8, 'the caller edits the active one');
  assert.equal(items(pres, 'en').length, 7);

  mirrorCollectionOp(pres, 'other', ['items'], { kind: 'remove', index: 0 });
  assert.equal(items(pres, 'en').length, 7, 'no such slide: nothing happens');

  const single = { slides: [timeline(NL, 'nl')] };
  assert.doesNotThrow(() =>
    mirrorCollectionOp(single, 'tl', ['items'], { kind: 'remove', index: 0 }),
  );
  assert.equal(single.slides[0].content.items.length, 8);
});

test('a swap is mirrored like the image-set arrows make it', () => {
  const pres = bilingualDeck();
  mirrorCollectionOp(pres, 'tl', ['items'], { kind: 'swap', a: 1, b: 2 });
  assert.deepEqual(
    items(pres, 'en')
      .slice(0, 3)
      .map((it) => it.date),
    ['Jan', 'Mar', 'Feb'],
  );
});
