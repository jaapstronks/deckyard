/**
 * Deleting a table row or column keeps every language version matched per
 * cell, not per position (B875, the table half of DY-773).
 *
 * The table grid deleted a row or column in the active version only; the
 * save-time sync then matched the other version's rows and `c1…cN` cells by
 * index, so after deleting row 2 the EN row 2 still sat under NL row 3, and
 * after deleting column B every EN cell from B on belonged to the column to
 * its left. Both deletes are now mirrored (`collection-mirror.js`, ops
 * `remove` and `removeColumn` on the rows).
 *
 * Run with: node --test tests/table-grid-i18n-per-cell.test.js
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
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const { createTableGridEditor } =
  await import('../client/views/editor/fields/table-grid.js');
const { mirrorCollectionOp } =
  await import('../client/lib/slide-authoring/collection-mirror.js');

/** A 3×3 table whose cell (r, c) reads `<lang> r<r>c<c>`. */
function table(lang) {
  return {
    id: 't1',
    type: 'table-slide',
    notes: '',
    content: {
      colCount: '3',
      headerRow: 'on',
      rows: [1, 2, 3].map((r) => ({
        c1: `${lang} r${r}c1`,
        c2: `${lang} r${r}c2`,
        c3: `${lang} r${r}c3`,
      })),
    },
  };
}

function bilingualDeck() {
  const nl = [table('nl')];
  return {
    id: 'p1',
    slides: nl,
    i18n: {
      active: 'nl',
      versions: {
        nl: { slides: nl },
        en: { slides: [table('en')] },
      },
    },
  };
}

function mountGrid(pres) {
  const el = createTableGridEditor({
    slide: pres.slides[0],
    pres,
    markDirty: () => {},
    rerenderEditor: () => {},
    scheduleUiRefresh: () => {},
  });
  document.body.replaceChildren(el);
  return el;
}

/** Every cell's text with the language prefix stripped, per version. */
function cells(pres, lang) {
  return pres.i18n.versions[lang].slides[0].content.rows.map((row) =>
    Object.keys(row)
      .sort()
      .map((k) => row[k].replace(`${lang} `, '')),
  );
}

test('deleting row 2 in the grid removes EN row 2 too', () => {
  const pres = bilingualDeck();
  const el = mountGrid(pres);
  const deleteRow2 = el.querySelector('button[title="Delete row 2"]');
  assert.ok(deleteRow2, 'the grid shows a delete button for row 2');
  deleteRow2.click();

  const expected = [
    ['r1c1', 'r1c2', 'r1c3'],
    ['r3c1', 'r3c2', 'r3c3'],
  ];
  assert.deepEqual(cells(pres, 'nl'), expected);
  assert.deepEqual(cells(pres, 'en'), expected);
});

test('deleting column B in the grid shifts the EN cells the same way', () => {
  const pres = bilingualDeck();
  const el = mountGrid(pres);
  const deleteColB = el.querySelector('button[title="Delete column B"]');
  assert.ok(deleteColB, 'the grid shows a delete button for column B');
  deleteColB.click();

  const expected = [1, 2, 3].map((r) => [`r${r}c1`, `r${r}c3`]);
  assert.deepEqual(cells(pres, 'nl'), expected);
  assert.deepEqual(cells(pres, 'en'), expected);
});

test('removeColumn leaves a row without the later cells alone', () => {
  const pres = bilingualDeck();
  pres.i18n.versions.en.slides[0].content.rows = [{ c1: 'only' }, 'junk'];
  mirrorCollectionOp(pres, 't1', ['rows'], { kind: 'removeColumn', column: 2 });
  assert.deepEqual(pres.i18n.versions.en.slides[0].content.rows, [
    { c1: 'only' },
    'junk',
  ]);
});
