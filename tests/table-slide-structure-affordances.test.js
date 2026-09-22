import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { INLINE_DESCRIPTORS } from '../client/views/editor/inline-edit/descriptors.js';
import { resolveItemDefaults } from '../shared/slide-types/item-defaults.js';
import {
  addTabularColumn,
  deleteTabularColumn,
  emptyTabularRow,
  tabularColumnCount,
} from '../shared/slide-types/tabular.js';
import { TABLE_COLUMN_KEYS } from '../shared/slide-types/types/table-slide.js';

/**
 * B394 — a user could not add a row to a table on the canvas. Nothing was
 * broken: the "+" hung off `.md-table-wrap`, a flex box that fills the whole
 * slide body, so with the default `bottom-center` placement it landed on the
 * bottom edge of the slide instead of under the last row. It also read
 * "Add item", it is gone while a cell is being typed in, and the column axis
 * lived only inside the form's grid, behind the "Edit all text" modal.
 *
 * These tests pin the route, not the handler: which element the affordances
 * hang from, what they are called, what a new row is made of, and that the
 * two surfaces that can grow a table agree about all three.
 */

const TABLE = SLIDE_TYPES['table-slide'];
const ROWS_FIELD = TABLE.fields.find((f) => f.key === 'rows');
const DESCRIPTOR = INLINE_DESCRIPTORS['table-slide'];
const MAX_COLS = ROWS_FIELD.itemFields.length;

/** The canvas DOM for a table of `cols` columns and `rows.length` rows. */
function renderTable(content) {
  const html = TABLE.renderHtml({
    ...structuredClone(TABLE.defaults),
    ...content,
  });
  return new JSDOM(`<body>${html}</body>`).window.document;
}

const smallTable = {
  title: 'Planning',
  colCount: '4',
  rows: [
    { c1: 'Fase', c2: 'Wat', c3: 'Wie', c4: 'Wanneer' },
    { c1: '1', c2: 'Opzet', c3: 'Marjolein', c4: 'okt' },
    { c1: '2', c2: 'Uitvoering', c3: 'Team', c4: 'nov' },
  ],
};

// ─── the route ───────────────────────────────────────────────────────────────

test('the add-row button hangs off the table, not the full-height wrap', () => {
  const doc = renderTable(smallTable);
  const anchor = doc.querySelectorAll(DESCRIPTOR.cards.addAnchor);

  // One anchor in the canvas subtree, and it is the table element itself.
  assert.equal(anchor.length, 1);
  assert.equal(anchor[0].tagName, 'TABLE');

  // The bug in one assertion: the wrap's box is not the table's box. Anchoring
  // a `bottom-center` button to the wrap puts it below everything the wrap
  // stretches over, which on a three-row table is most of the slide.
  const wrap = doc.querySelector(DESCRIPTOR.cards.container);
  assert.notEqual(
    DESCRIPTOR.cards.addAnchor,
    DESCRIPTOR.cards.container,
    'the add button must not fall back to the container',
  );
  assert.ok(wrap.contains(anchor[0]) && wrap !== anchor[0]);

  // And the anchor really is the element that ends at the last row: every row
  // the card layer counts lives inside it, and it has no element after them.
  const rows = [...doc.querySelectorAll('[data-inline-item="rows"]')];
  assert.equal(rows.length, 3);
  assert.ok(rows.every((tr) => anchor[0].contains(tr)));
  assert.equal(anchor[0].lastElementChild.contains(rows.at(-1)), true);
});

test('the row affordances say row, not item', () => {
  // "Add item" on a table is the generic fallback leaking through; the label
  // is what tells a user the button is the one they are looking for.
  assert.equal(DESCRIPTOR.cards.addLabelKey, 'editor.inline.addRow');
  assert.equal(DESCRIPTOR.cards.addLabel, 'Add row');
  assert.equal(DESCRIPTOR.cards.removeLabelKey, 'editor.inline.removeRow');
});

test('the column axis has a canvas affordance of its own', () => {
  const columns = DESCRIPTOR.cards.columns;
  assert.ok(columns, 'table-slide declares cards.columns');
  assert.equal(columns.addLabelKey, 'editor.inline.addColumn');

  // It hangs off the same element as the row button, on the other side, so the
  // two structural axes read as one pair.
  assert.equal(columns.addAnchor, DESCRIPTOR.cards.addAnchor);
  assert.equal(columns.addPlacement, 'right-outside');
  assert.equal(
    renderTable(smallTable).querySelectorAll(columns.addAnchor).length,
    1,
  );

  // The mechanics read the field's own declaration, so a fork's tabular type
  // resolves the same way without naming a type.
  assert.equal(ROWS_FIELD.columnCountKey, 'colCount');
});

// ─── what a new row is made of ───────────────────────────────────────────────

test('a new row on the canvas is as wide as the table is', () => {
  // Before B394 this resolved to `{}` — the `rows` field declares no
  // `itemDefaults`, so the generic skeleton was empty. The renderer normalized
  // it, so it looked right while two shapes for one concept sat in decks.
  assert.deepEqual(resolveItemDefaults(ROWS_FIELD, 'nl', { colCount: '3' }), {
    c1: '',
    c2: '',
    c3: '',
  });
  assert.deepEqual(resolveItemDefaults(ROWS_FIELD, 'nl', { colCount: '4' }), {
    c1: '',
    c2: '',
    c3: '',
    c4: '',
  });

  // Cell placeholder copy is never deck language: an empty cell is empty in
  // every locale, so the lang argument changes nothing here.
  assert.deepEqual(
    resolveItemDefaults(ROWS_FIELD, 'en-GB', { colCount: '2' }),
    resolveItemDefaults(ROWS_FIELD, 'nl', { colCount: '2' }),
  );
});

test('both surfaces that grow a table build the same row', () => {
  // The form grid's `emptyRow` and the canvas add button now resolve through
  // one function, so they cannot drift apart again.
  const content = { colCount: '5', rows: [] };
  assert.deepEqual(
    resolveItemDefaults(ROWS_FIELD, null, content),
    emptyTabularRow(5),
  );
});

test('a clamped or absent column count still yields a usable row', () => {
  assert.deepEqual(emptyTabularRow(1), { c1: '' });
  assert.equal(
    Object.keys(resolveItemDefaults(ROWS_FIELD, null, {}, TABLE.defaults))
      .length,
    4,
    'no count on the slide takes the one the type declares in `defaults`',
  );
  // The default lives in the type's `defaults` alone: the shared module holds
  // no second one (B396).
  assert.equal(
    tabularColumnCount({}, { columnCountKey: 'colCount', maxCols: MAX_COLS }),
    1,
  );
  assert.equal(TABLE.defaults.colCount, '4');
  assert.equal(tabularColumnCount({}, TABLE_COLUMN_KEYS), 4);
  // …and the renderer draws a count-less slide at that same width.
  const { colCount: _omit, ...countless } = structuredClone(TABLE.defaults);
  const doc = new JSDOM(`<body>${TABLE.renderHtml(countless)}</body>`).window
    .document;
  assert.equal(doc.querySelectorAll('.md-table thead th').length, 4);
  assert.equal(
    tabularColumnCount(
      { colCount: '99' },
      {
        columnCountKey: 'colCount',
        maxCols: MAX_COLS,
      },
    ),
    MAX_COLS,
  );
});

// ─── the column mutation ─────────────────────────────────────────────────────

const KEYS = {
  rowsKey: 'rows',
  columnCountKey: 'colCount',
  maxCols: MAX_COLS,
};

test('adding a column widens the count and every existing row', () => {
  const content = structuredClone(smallTable);
  assert.equal(addTabularColumn(content, KEYS), true);
  assert.equal(content.colCount, '5');
  for (const row of content.rows) assert.equal(row.c5, '');
  // Existing cells are untouched.
  assert.equal(content.rows[1].c3, 'Marjolein');

  // The rendered table really gains the column, so the canvas shows the result
  // of the click rather than only the content growing underneath it.
  const doc = renderTable(content);
  assert.equal(doc.querySelectorAll('.md-table thead th').length, 5);
});

test('adding a column refuses at the declared maximum, silently and cleanly', () => {
  const content = {
    colCount: String(MAX_COLS),
    rows: [emptyTabularRow(MAX_COLS)],
  };
  assert.equal(addTabularColumn(content, KEYS), false);
  assert.equal(content.colCount, String(MAX_COLS));
  assert.equal(Object.keys(content.rows[0]).length, MAX_COLS);
});

test('deleting a middle column shifts the ones after it left', () => {
  const content = structuredClone(smallTable);
  assert.equal(deleteTabularColumn(content, 2, KEYS), true);
  assert.equal(content.colCount, '3');
  assert.deepEqual(content.rows[1], {
    c1: '1',
    c2: 'Marjolein',
    c3: 'okt',
  });
});

test('the last column cannot be deleted', () => {
  const content = { colCount: '1', rows: [{ c1: 'only' }] };
  assert.equal(deleteTabularColumn(content, 1, KEYS), false);
  assert.equal(content.colCount, '1');
});
