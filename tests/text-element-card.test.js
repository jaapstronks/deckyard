/**
 * The "This text" card shows no live control without an effect (B464 PR 2).
 *
 * A markdown body that is only a bullet or numbered list stays on its markers
 * whatever alignment the block gets (docs/reference/text-alignment.md), so an
 * offered alignment would do nothing there. The card shows it disabled with
 * one line saying why, and live again once the text has a paragraph. The
 * size control is unaffected: it scales a list too.
 *
 * Run with: node --test tests/text-element-card.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/p1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;

const { createFieldRenderers } =
  await import('../client/views/editor/fields/index.js');
const { renderTextElementCard } =
  await import('../client/views/editor/editor-form/text-element-card.js');

/** The card for `fieldKey` on a content slide with `body`. */
function card(body, fieldKey = 'body') {
  const container = document.createElement('div');
  renderTextElementCard({
    container,
    slide: { id: 's', type: 'content-slide', content: { title: 'T', body } },
    fieldKey,
    fieldRenderers: createFieldRenderers({}),
    markDirty: () => {},
  });
  return container;
}

const buttons = (el, values) =>
  values
    .map((v) => el.querySelector(`button[data-value="${v}"]`))
    .filter(Boolean);
const alignButtons = (el) => buttons(el, ['left', 'center', 'right']);

test('a list-only body shows alignment disabled, with the reason', () => {
  const el = card('- First point\n- Second point');
  const align = alignButtons(el);
  assert.equal(align.length, 3);
  assert.ok(align.every((b) => b.disabled));
  assert.match(el.textContent, /stays aligned with its bullets/);
});

test('a body with a paragraph keeps alignment live', () => {
  const el = card('Intro line\n\n- First point');
  const align = alignButtons(el);
  assert.equal(align.length, 3);
  assert.ok(align.every((b) => !b.disabled));
  assert.doesNotMatch(el.textContent, /stays aligned with its bullets/);
});

test('the size control stays live on a list-only body', () => {
  const el = card('- First point');
  const size = buttons(el, ['sm', 'md', 'lg']);
  assert.equal(size.length, 3);
  assert.ok(size.every((b) => !b.disabled));
});
