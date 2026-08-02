/**
 * Generic collection editor (editor-behaviour-abstraction step 3): ONE
 * schema-driven add/remove/reorder/collapse machine replaces the seven
 * hand-built per-type collection forms. These tests drive the bulk-modal
 * (contentOnly) render path for the migrated types and assert the editor is
 * driven by the collection field's schema: item widgets, collapse
 * declarations, min/max enforcement, the legacy-mirror skip, and nested
 * collections.
 *
 * Run with: node --test tests/collection-editor.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { h } = await import('../client/lib/dom.js');
const { createFieldRenderers } = await import('../client/views/editor/fields.js');
const { createRerenderEditor } = await import('../client/views/editor/editor-form.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

function renderForm({ type, content }) {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const slide = { id: 's1', type, content };
  const pres = { id: 'p1', slides: [slide], settings: {} };
  const noop = () => {};
  const deps = {
    h,
    pres,
    user: {},
    markDirty: noop,
    scheduleUiRefresh: noop,
    rerenderEditor: noop,
    updateSelectedSlideListItem: noop,
    normalizeLang: (l) => l,
  };
  const rerender = createRerenderEditor({
    ...deps,
    editorMount,
    SLIDE_TYPES,
    api: null,
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: noop,
    editorState: {},
    requestSave: noop,
    rerenderSlideList: noop,
    rerenderPreview: noop,
    fieldRenderers: createFieldRenderers(deps),
    openOverlayClosers: new Set(),
    contentOnly: true,
  }).rerender;
  rerender();
  return { editorMount, slide };
}

const labelsOf = (root) =>
  Array.from(root.querySelectorAll('.field-label')).map((el) => el.textContent);

test('gallery: schema-driven collection with collapse, hidden focus fields', () => {
  const { editorMount, slide } = renderForm({
    type: 'gallery-slide',
    content: structuredClone(SLIDE_TYPES['gallery-slide'].defaults),
  });
  const groups = editorMount.querySelectorAll('.items-reorder-list .card-group');
  assert.equal(groups.length, slide.content.images.length);
  // collapsible: true → per-item chevron + bulk toggle
  assert.ok(editorMount.querySelector('.row-collapse-toggle'));
  assert.ok(editorMount.querySelector('.collapse-all-toggle'));
  // hidden focus item fields don't render as inputs
  const labels = labelsOf(editorMount);
  assert.ok(!labels.some((l) => /Focus X|Focus Y/.test(l)));
  // caption + alt render per item
  assert.ok(labels.filter((l) => l === 'Caption').length >= 2);
});

test('gallery: add respects maxItems, remove respects minItems', () => {
  const content = structuredClone(SLIDE_TYPES['gallery-slide'].defaults);
  content.images = content.images.slice(0, 2); // at minItems
  const { editorMount, slide } = renderForm({ type: 'gallery-slide', content });
  // at minItems=2 every per-item remove is disabled
  for (const btn of editorMount.querySelectorAll('.card-remove-btn')) {
    assert.equal(btn.disabled, true);
  }
  // add up to maxItems (6)
  const addBtn = Array.from(editorMount.querySelectorAll('button')).find((b) =>
    b.textContent.startsWith('+')
  );
  for (let i = 0; i < 10; i += 1) addBtn.click();
  assert.equal(slide.content.images.length, 6);
});

test('icon-card-grid: editor-marked exceptions render icon picker and card link', () => {
  const content = structuredClone(SLIDE_TYPES['icon-card-grid-slide'].defaults);
  const { editorMount } = renderForm({ type: 'icon-card-grid-slide', content });
  // `editor: 'icon-picker'` on the icon item field
  assert.ok(editorMount.querySelector('.icon-picker-trigger'));
  // `editor: 'card-link'` renders the card-link widget (a select of targets)
  assert.ok(editorMount.querySelector('.card-group select'));
});

test('keyboard reorder: ArrowDown on the drag handle moves the item', () => {
  const content = structuredClone(SLIDE_TYPES['gallery-slide'].defaults);
  content.images = [
    { src: 'a.jpg', caption: 'A', alt: '' },
    { src: 'b.jpg', caption: 'B', alt: '' },
    { src: 'c.jpg', caption: 'C', alt: '' },
  ];
  const { editorMount, slide } = renderForm({ type: 'gallery-slide', content });
  const handle = editorMount.querySelector('.items-reorder-list .card-group .item-drag-handle');
  handle.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
  );
  assert.deepEqual(
    slide.content.images.map((i) => i.caption),
    ['B', 'A', 'C']
  );
});

test('text-blocks: nested blocks collection, relation field skipped on last row', () => {
  const { editorMount, slide } = renderForm({
    type: 'text-blocks-slide',
    content: {
      title: 'T',
      rows: [
        { title: '', color: 'yellow', arrow: 'down', blocks: [{ title: 'B1', body: '' }] },
        { title: 'R2', color: 'black', arrow: 'none', blocks: [{ title: 'B2', body: '' }] },
      ],
    },
  });
  const outerList = editorMount.querySelector('.items-reorder-list');
  // (children-filter, not `:scope >` — jsdom treats the latter as descendant)
  const rows = Array.from(outerList.children).filter((c) => c.classList.contains('card-group'));
  assert.equal(rows.length, 2);
  // nested collection editor inside each row
  assert.ok(rows[0].querySelector('.items-reorder-list .card-group'));
  // the relation enum (arrow) renders on the first row, not the last
  const enumLabels = (row) =>
    Array.from(row.querySelectorAll('.field-label'))
      .filter((el) => !el.closest('.collection-editor .collection-editor'))
      .map((el) => el.textContent);
  assert.ok(enumLabels(rows[0]).some((l) => /Arrow/i.test(l)));
  assert.ok(!enumLabels(rows[1]).some((l) => /Arrow/i.test(l)));
  // adding a block through the nested editor grows the row's blocks[]
  const nestedAdd = Array.from(rows[1].querySelectorAll('button')).find((b) =>
    b.textContent.includes('Add block')
  );
  nestedAdd.click();
  assert.equal(slide.content.rows[1].blocks.length, 2);
});

test('kpi-metrics: generic items path keeps the metric field pairing', () => {
  const content = structuredClone(SLIDE_TYPES['kpi-metrics-slide'].defaults);
  const { editorMount } = renderForm({ type: 'kpi-metrics-slide', content });
  const labels = labelsOf(editorMount);
  for (const want of ['Value', 'Unit', 'Label']) {
    assert.ok(
      labels.some((l) => l.includes(want)),
      `missing metric field ${want}`
    );
  }
  // The pairing is a formLayout declaration on the item fields, rendered as
  // declared rows: value+unit share one .field-grid, label gets its own.
  const firstItem = editorMount.querySelector('.items-reorder-list .card-group');
  const rows = Array.from(firstItem.querySelectorAll('.field-grid')).map((g) =>
    labelsOf(g)
  );
  assert.deepEqual(rows[0], ['Value', 'Unit'], 'value and unit share the first row');
  assert.deepEqual(rows[1], ['Label'], 'label stands on its own row');
});

test('team-cards and logo-wall run generic: collection renders from schema', () => {
  for (const [type, key, seed] of [
    ['team-cards-slide', 'members', [{ image: '', alt: '', name: 'N', byline: 'B', linkedin: '' }]],
    ['logo-wall-slide', 'logos', [{ image: '', name: 'L', alt: '', link: '' }]],
  ]) {
    const content = structuredClone(SLIDE_TYPES[type].defaults);
    content[key] = seed;
    const { editorMount } = renderForm({ type, content });
    const groups = editorMount.querySelectorAll('.items-reorder-list .card-group');
    assert.equal(groups.length, 1, `${type}: expected one item card`);
    assert.ok(
      editorMount.querySelector('.collapse-all-toggle') === null,
      `${type}: bulk toggle hidden for a single item`
    );
  }
});
