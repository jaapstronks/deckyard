/**
 * Shared segmented-control factory (client/lib/segmented.js).
 *
 * Three copies of the same control existed: the canonical `.sb-segmented` and
 * two hand-rolled look-alikes (`.pane-tabs`, `.comments-scope`) with their own
 * CSS and their own is-active/aria-pressed bookkeeping. This covers the
 * bookkeeping the factory took over, including the `selectOnClick: false` mode
 * both migrated controls use (their owner decides what selection means —
 * clicking the active pane tab dismisses the rail rather than re-selecting).
 *
 * Run with: node --test tests/segmented-control.test.js
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

const { createSegmented } = await import('../client/lib/segmented.js');

const SEGMENTS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

const stateOf = (el) =>
  [...el.querySelectorAll('.sb-segmented-btn')].map((b) => [
    b.classList.contains('is-active'),
    b.getAttribute('aria-pressed'),
  ]);

test('renders the canonical classes and selects the first segment by default', () => {
  const { el } = createSegmented({ segments: SEGMENTS });
  assert.equal(el.className, 'sb-segmented');
  assert.equal(el.getAttribute('role'), 'group');
  assert.deepEqual(stateOf(el), [[true, 'true'], [false, 'false']]);
});

test('the outlined variant is a class on the same control, not a new one', () => {
  const { el } = createSegmented({
    segments: SEGMENTS,
    outlined: true,
    className: 'pane-tabs',
    buttonClass: 'pane-tab',
  });
  assert.equal(el.className, 'sb-segmented is-outlined pane-tabs');
  const btn = el.querySelector('.sb-segmented-btn');
  assert.ok(btn.classList.contains('pane-tab'), 'legacy hook class kept');
});

test('clicking moves the selection and reports the value', () => {
  const seen = [];
  const { el, getValue } = createSegmented({
    segments: SEGMENTS,
    onSelect: (v) => seen.push(v),
  });
  el.querySelectorAll('.sb-segmented-btn')[1].click();
  assert.deepEqual(seen, ['b']);
  assert.equal(getValue(), 'b');
  assert.deepEqual(stateOf(el), [[false, 'false'], [true, 'true']]);
});

test('selectOnClick:false reports clicks without moving the highlight itself', () => {
  const seen = [];
  const { el, setValue } = createSegmented({
    segments: SEGMENTS,
    value: null,
    selectOnClick: false,
    onSelect: (v) => seen.push(v),
  });
  assert.deepEqual(stateOf(el), [[false, 'false'], [false, 'false']], 'nothing selected');

  el.querySelectorAll('.sb-segmented-btn')[0].click();
  assert.deepEqual(seen, ['a']);
  assert.deepEqual(stateOf(el), [[false, 'false'], [false, 'false']], 'owner has not said yes');

  // The owner accepts, then later dismisses — the pane-tabs lifecycle.
  setValue('a');
  assert.deepEqual(stateOf(el), [[true, 'true'], [false, 'false']]);
  setValue(null);
  assert.deepEqual(stateOf(el), [[false, 'false'], [false, 'false']]);
});

test('custom content is appended and the value is still tracked', () => {
  const icon = document.createElement('img');
  const { el, buttons } = createSegmented({
    segments: [{ value: 'x', content: [icon, 'Label'] }, { value: 'y', label: 'Y' }],
  });
  assert.equal(buttons.get('x').querySelector('img'), icon);
  assert.match(buttons.get('x').textContent, /Label/);
  assert.deepEqual(stateOf(el), [[true, 'true'], [false, 'false']]);
});
