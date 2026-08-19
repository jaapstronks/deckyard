/**
 * Shared labeled-checkbox factory (client/lib/dom/labeled-checkbox.js).
 *
 * The settings/modal surfaces hand-rolled the same "checkbox + label (+ help)"
 * recipe under four re-spelled wrapper classes (A7.16 cluster 9). This covers
 * the markup and wiring the factory took over, and — with the class kept as a
 * parameter — that each surface's visual class survives migration.
 *
 * Run with: node --test tests/labeled-checkbox.test.js
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
globalThis.SVGElement = dom.window.SVGElement;

const { labeledCheckbox } =
  await import('../client/lib/dom/labeled-checkbox.js');

test('default builds label.admin-checkbox-item > input[type=checkbox] + span', () => {
  const { element, input } = labeledCheckbox({ text: 'Enable X' });
  assert.equal(element.tagName, 'LABEL');
  assert.equal(element.className, 'admin-checkbox-item');
  assert.equal(element.children[0], input);
  assert.equal(input.tagName, 'INPUT');
  assert.equal(input.type, 'checkbox');
  assert.equal(input.checked, false);
  const span = element.children[1];
  assert.equal(span.tagName, 'SPAN');
  assert.equal(span.textContent, 'Enable X');
});

test('checked sets the property, not just the attribute', () => {
  const { input } = labeledCheckbox({ text: 'On', checked: true });
  assert.equal(input.checked, true);
});

test('className keeps each surface visual (the class is a parameter)', () => {
  const { element } = labeledCheckbox({
    text: 'Designer',
    className: 'form-checkbox-row',
  });
  assert.equal(element.className, 'form-checkbox-row');
});

test('content overrides text and is appended after the input', () => {
  const title = document.createElement('span');
  title.textContent = 'AI';
  const desc = document.createElement('span');
  desc.textContent = 'Use AI features';
  const { element, input } = labeledCheckbox({
    className: 'api-key-permission-checkbox',
    content: [title, desc],
    text: 'ignored when content is given',
  });
  assert.equal(element.className, 'api-key-permission-checkbox');
  assert.deepEqual([...element.children], [input, title, desc]);
});

test('inputAttrs and labelAttrs pass through (id/for/value/data-*)', () => {
  const { element, input } = labeledCheckbox({
    text: 'Versions',
    inputAttrs: { id: 'export-opt-v', value: 'v' },
    labelAttrs: { for: 'export-opt-v' },
  });
  assert.equal(input.id, 'export-opt-v');
  assert.equal(input.getAttribute('value'), 'v');
  assert.equal(element.getAttribute('for'), 'export-opt-v');
});

test('onChange fires with the current checked state', () => {
  const seen = [];
  const { input } = labeledCheckbox({
    text: 'Toggle',
    onChange: (v) => seen.push(v),
  });
  input.checked = true;
  input.dispatchEvent(new dom.window.Event('change'));
  input.checked = false;
  input.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(seen, [true, false]);
});
