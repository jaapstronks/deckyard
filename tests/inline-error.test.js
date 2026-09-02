/**
 * The inline refusal helper: one element, the ARIA that goes with it, and
 * where focus lands (B202).
 *
 * Before this the client had 26 hand-rolled spellings of "the form said no"
 * and one that set `aria-invalid`; none pointed the control at its message
 * with `aria-describedby`, and a refusal moved focus in 3 of 21 cases. The
 * doctrine is docs/reference/feedback-surfaces.md; this pins the helper.
 *
 * Run with: node --test tests/inline-error.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { h } = await import('../client/lib/dom.js');
const { createInlineError } = await import('../client/lib/dom/inline-error.js');
const { isDevRuntime } = await import('../client/lib/util/dev-runtime.js');

/** A form with one input, mounted so focus() has somewhere to land. */
function mount(opts) {
  const input = h('input', { class: 'form-input', type: 'text' });
  const error = createInlineError(opts);
  const form = h('div', {}, [input, error.el]);
  document.body.append(form);
  return { input, error, form };
}

test('starts hidden, as an alert, focusable by script only', () => {
  const { error } = mount();
  assert.equal(error.el.hidden, true);
  assert.equal(error.shown, false);
  assert.equal(error.el.getAttribute('role'), 'alert');
  assert.equal(error.el.getAttribute('tabindex'), '-1');
  assert.ok(error.el.classList.contains('inline-error'));
  assert.ok(error.el.id, 'has an id for aria-describedby to point at');
});

test('the polite form is a status, for hints while typing', () => {
  const { error } = mount({ live: 'polite' });
  assert.equal(error.el.getAttribute('role'), 'status');
});

test('the callout form is the same element with a modifier', () => {
  const { error } = mount({ callout: true });
  assert.ok(error.el.classList.contains('inline-error'));
  assert.ok(error.el.classList.contains('is-callout'));
});

test('show() names the control: aria-invalid, aria-describedby, focus', () => {
  const { input, error } = mount();
  error.show('Name is required.', { control: input });

  assert.equal(error.el.hidden, false);
  assert.equal(error.el.textContent, 'Name is required.');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(input.getAttribute('aria-describedby'), error.el.id);
  assert.equal(document.activeElement, input, 'focus lands on the control');
});

test('with no control, focus lands on the message itself', () => {
  const { error } = mount();
  error.show('At least one field is required.');
  assert.equal(document.activeElement, error.el);
});

test('focus can be pointed elsewhere, or left alone', () => {
  const { input, error, form } = mount();
  const summary = h('button', { type: 'button', text: 'Row 2' });
  form.append(summary);

  error.show('Row 2 has no options.', { focus: summary });
  assert.equal(document.activeElement, summary);

  input.focus();
  error.show('Still typing.', { control: input, focus: false });
  assert.equal(document.activeElement, input, 'focus did not move');
  assert.equal(input.getAttribute('aria-invalid'), 'true', 'but the ARIA did');
});

test('aria-describedby keeps the ids a help text already put there', () => {
  const { input, error } = mount();
  input.setAttribute('aria-describedby', 'help-1');
  error.show('No.', { control: input });
  assert.equal(input.getAttribute('aria-describedby'), `help-1 ${error.el.id}`);
  error.clear();
  assert.equal(input.getAttribute('aria-describedby'), 'help-1');
});

test('clear() hides the message and releases the control', () => {
  const { input, error } = mount();
  error.show('No.', { control: input });
  error.clear();
  assert.equal(error.el.hidden, true);
  assert.equal(error.shown, false);
  assert.equal(error.el.textContent, '');
  assert.equal(input.hasAttribute('aria-invalid'), false);
  assert.equal(input.hasAttribute('aria-describedby'), false);
});

test('a second show() moves the marking to the new control', () => {
  const { input, error, form } = mount();
  const other = h('input', { class: 'form-input', type: 'text' });
  form.append(other);
  error.show('First.', { control: input });
  error.show('Second.', { control: other });
  assert.equal(input.hasAttribute('aria-invalid'), false);
  assert.equal(other.getAttribute('aria-invalid'), 'true');
  assert.equal(error.el.textContent, 'Second.');
});

test('a message that is not a sentence is a programming error (dev throws)', () => {
  assert.equal(isDevRuntime(), true, 'jsdom on localhost counts as dev');
  const { error } = mount();
  assert.throws(() => error.show(''), /needs the sentence/);
  assert.throws(() => error.show(h('span')), /needs the sentence/);
});

test('isDevRuntime reads the host, so a real domain is production', async () => {
  const prod = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://slides.example.org/app',
  });
  const saved = globalThis.window;
  globalThis.window = prod.window;
  try {
    assert.equal(isDevRuntime(), false);
  } finally {
    globalThis.window = saved;
  }
});
