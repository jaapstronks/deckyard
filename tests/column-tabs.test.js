/**
 * Column tabs (client/lib/dom/column-tabs.js) and the two editor strips built
 * on them (D335): Canvas | Fields above the canvas column, Inspector |
 * Comments in the head of the right-hand column.
 *
 * Run with: node --test tests/column-tabs.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { createColumnTabs } = await import('../client/lib/dom/column-tabs.js');
const { createPaneTabs } = await import('../client/views/editor/pane-tabs.js');
const { createCanvasTabs } =
  await import('../client/views/editor/canvas-tabs.js');

const TABS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

const selected = (el) =>
  [...el.querySelectorAll('[role="tab"]')].map(
    (b) => `${b.dataset.value}:${b.getAttribute('aria-selected')}`,
  );

test('renders a tablist of tabs and selects the first by default', () => {
  const { el } = createColumnTabs({ tabs: TABS, ariaLabel: 'View' });
  assert.equal(el.getAttribute('role'), 'tablist');
  assert.equal(el.getAttribute('aria-label'), 'View');
  assert.ok(el.classList.contains('column-tabs'));
  assert.deepEqual(selected(el), ['a:true', 'b:false']);
  assert.ok(
    el.querySelector('[data-value="a"]').classList.contains('is-active'),
  );
});

test('a click moves the selection and reports the value', () => {
  const seen = [];
  const { el, getValue } = createColumnTabs({
    tabs: TABS,
    onSelect: (v) => seen.push(v),
  });
  el.querySelector('[data-value="b"]').click();
  assert.deepEqual(selected(el), ['a:false', 'b:true']);
  assert.equal(getValue(), 'b');
  assert.deepEqual(seen, ['b']);
});

test('an owner-driven strip only reports; setValue(null) selects none', () => {
  const { el, setValue } = createColumnTabs({
    tabs: TABS,
    value: null,
    selectOnClick: false,
    onSelect: () => {},
  });
  assert.deepEqual(selected(el), ['a:false', 'b:false']);
  el.querySelector('[data-value="a"]').click();
  assert.deepEqual(
    selected(el),
    ['a:false', 'b:false'],
    'owner has not said yes',
  );
  setValue('a');
  assert.deepEqual(selected(el), ['a:true', 'b:false']);
  setValue(null);
  assert.deepEqual(selected(el), ['a:false', 'b:false']);
});

test('pane tabs: selected means "rail open on MY pane"', () => {
  const calls = [];
  const pane = createPaneTabs({
    onToggleInspector: () => calls.push('settings'),
    onToggleComments: () => calls.push('comments'),
  });
  assert.ok(pane.el.classList.contains('column-tabs'));
  assert.deepEqual(selected(pane.el), ['settings:false', 'comments:false']);

  pane.setState({ open: true, pane: 'comments' });
  assert.deepEqual(selected(pane.el), ['settings:false', 'comments:true']);

  // Clicking reports the toggle; the rail decides, so nothing moves yet.
  pane.el.querySelector('[data-value="comments"]').click();
  assert.deepEqual(calls, ['comments']);
  assert.deepEqual(selected(pane.el), ['settings:false', 'comments:true']);

  pane.setState({ open: false, pane: 'comments' });
  assert.deepEqual(selected(pane.el), ['settings:false', 'comments:false']);

  // Each tab keeps its name when the labels hide in the dismissed rail.
  for (const tab of pane.el.querySelectorAll('[role="tab"]')) {
    assert.ok(tab.getAttribute('aria-label'));
  }
});

test('pane tabs: the comments badge shows a count and a seen state', () => {
  const pane = createPaneTabs();
  const badge = pane.el.querySelector('.pane-tab-badge');
  assert.equal(badge.hidden, true);
  pane.updateBadge({ count: 3, hasNew: false });
  assert.equal(badge.textContent, '3');
  assert.equal(badge.hidden, false);
  assert.ok(badge.classList.contains('pane-tab-badge--seen'));
});

test('canvas tabs: Fields opens the fields view and hands back to Canvas', () => {
  let opened = 0;
  const tabs = createCanvasTabs({ onOpenFields: () => opened++ });
  assert.deepEqual(selected(tabs.el), ['canvas:true', 'fields:false']);

  tabs.el.querySelector('[data-value="fields"]').click();
  assert.equal(opened, 1);
  assert.deepEqual(selected(tabs.el), ['canvas:false', 'fields:true']);

  tabs.showCanvas();
  assert.deepEqual(selected(tabs.el), ['canvas:true', 'fields:false']);

  // Canvas is the canvas: clicking it opens nothing.
  tabs.el.querySelector('[data-value="canvas"]').click();
  assert.equal(opened, 1);
});
