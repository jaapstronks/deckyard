/**
 * Step 4 of the editor-behaviour-abstraction brief, end to end: chart and
 * table no longer have hand-built side forms — the generic field loop renders
 * their declarations. `editor: 'table-grid'` swaps in the table widget, the
 * csv `data` field renders the grid (bulk) or the "Edit data…" entry point
 * (inspector), and `visibleWhen` shows each chart control only on the chart
 * types that draw it.
 *
 * Run with: node --test tests/field-editor-vocabulary.test.js
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
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { createFieldRenderers } =
  await import('../client/views/editor/fields.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

function renderForm({
  type,
  content,
  contentOnly = true,
  onEditChartData,
} = {}) {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const slide = {
    id: 's1',
    type,
    content: content || structuredClone(SLIDE_TYPES[type]?.defaults || {}),
  };
  const pres = { id: 'p1', slides: [slide], settings: {} };
  const noop = () => {};
  const deps = {
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
    contentOnly,
    onEditChartData,
  }).rerender;
  rerender();
  return { editorMount, slide };
}

const labelsOf = (root) =>
  Array.from(root.querySelectorAll('label, .field-label')).map((el) =>
    el.textContent.trim(),
  );

test('table: the rows field renders the table-grid widget, not a collection editor', () => {
  const { editorMount } = renderForm({ type: 'table-slide' });
  assert.ok(
    editorMount.querySelector('.table-editor-grid'),
    'cell grid renders',
  );
  assert.ok(
    editorMount.querySelector('.table-editor-import'),
    'markdown import renders',
  );
  assert.equal(
    editorMount.querySelector('.collection-editor'),
    null,
    'no generic collection editor for the c1…cN rows',
  );
  // colCount is managed by the widget (hidden: true) — never its own control.
  assert.ok(!labelsOf(editorMount).includes('Columns'), 'no raw colCount enum');
});

test('table: headerRow and tableStyle pair on one declared row', () => {
  const { editorMount } = renderForm({ type: 'table-slide' });
  const grid = Array.from(editorMount.querySelectorAll('.field-grid')).find(
    (g) => labelsOf(g).some((l) => l.includes('Header row')),
  );
  assert.ok(grid, 'headerRow renders inside a field-grid row');
  assert.ok(
    labelsOf(grid).some((l) => l.includes('Table style')),
    'tableStyle shares the row',
  );
});

test('table: cell edits write the rows array', () => {
  const { editorMount, slide } = renderForm({ type: 'table-slide' });
  const cell = editorMount.querySelector('.table-editor-cell');
  cell.value = 'Nieuw';
  cell.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(slide.content.rows[0].c1, 'Nieuw');
});

test('chart: visibleWhen shows only the controls the chart type draws', () => {
  const perType = {};
  for (const chartType of ['bar', 'line', 'pie']) {
    const content = structuredClone(SLIDE_TYPES['chart-slide'].defaults);
    content.chartType = chartType;
    const { editorMount } = renderForm({ type: 'chart-slide', content });
    perType[chartType] = labelsOf(editorMount);
  }
  const has = (t2, label) => perType[t2].some((l) => l.includes(label));

  assert.ok(has('bar', 'Show values'), 'bar: show-values toggle');
  assert.ok(!has('bar', 'Legend'), 'bar: no legend toggle');
  assert.ok(!has('bar', 'Pie labels'), 'bar: no pie labels');
  assert.ok(has('bar', 'X label') && has('bar', 'Y label'), 'bar: axis labels');
  assert.ok(!has('bar', 'Series 1 label'), 'bar: no series labels');

  assert.ok(has('line', 'Legend'), 'line: legend toggle');
  assert.ok(!has('line', 'Show values'), 'line: no show-values');
  assert.ok(has('line', 'Series 1 label'), 'line: series labels');
  assert.ok(has('line', 'X label'), 'line: axis labels');

  assert.ok(
    has('pie', 'Pie labels') && has('pie', 'Legend'),
    'pie: pie toggles',
  );
  assert.ok(!has('pie', 'X label'), 'pie: no axis labels');
  assert.ok(!has('pie', 'Series 1 label'), 'pie: no series labels');
});

test('chart: bulk modal renders the inline csv grid', () => {
  const { editorMount } = renderForm({ type: 'chart-slide' });
  assert.ok(
    editorMount.querySelector('.csv-grid-host'),
    'inline data grid renders',
  );
  assert.equal(
    editorMount.querySelector('.chart-data-entry'),
    null,
    'no entry-point button in the bulk modal',
  );
});

test('chart: inspector renders the "Edit data…" entry point instead of the grid', () => {
  let opened = 0;
  const { editorMount } = renderForm({
    type: 'chart-slide',
    contentOnly: false,
    onEditChartData: () => {
      opened += 1;
    },
  });
  const entry = editorMount.querySelector('.chart-data-entry');
  assert.ok(entry, 'entry point renders in the inspector');
  assert.equal(
    editorMount.querySelector('.csv-grid-host'),
    null,
    'no inline grid',
  );
  entry.querySelector('button').click();
  assert.equal(opened, 1, 'the button opens the data surface');
});
