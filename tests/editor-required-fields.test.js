/**
 * Client-side required-field feedback in the editor form.
 *
 * The field builders always set `input.required = true` for a field a slide
 * type declares required, but the inspector's fields are not in a <form> and
 * nothing called checkValidity(), so the attribute was inert: an empty
 * required field only failed on save, server-side, as a toast that did not say
 * which field. This covers the client half — mostly for custom slide types,
 * whose fields are author-defined, but it applies to every schema.
 *
 * Run with: node --test tests/editor-required-fields.test.js
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

const { h } = await import('../client/lib/dom.js');
const { createBasicFields } =
  await import('../client/views/editor/fields/basic.js');
const { emptyRequiredFields } =
  await import('../client/views/editor/fields/required.js');

const { fieldText, fieldMarkdown, fieldCode } = createBasicFields({});

const blur = (el) => el.dispatchEvent(new dom.window.Event('blur'));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new dom.window.Event('input'));
};

test('an optional field is untouched by any of this', () => {
  const wrap = fieldText('Title', '', () => {});
  assert.equal(wrap.classList.contains('is-required'), false);
  assert.equal(wrap.querySelector('.field-required-mark'), null);
  assert.equal(wrap.querySelector('.inline-error'), null);
});

test('a required field is marked before anything is typed, but not flagged', () => {
  const wrap = fieldText('Title', '', () => {}, { required: true });
  const input = wrap.querySelector('input');
  assert.ok(wrap.classList.contains('is-required'));
  assert.ok(
    wrap.querySelector('.field-required-mark'),
    'asterisk on the label',
  );
  assert.equal(input.getAttribute('aria-required'), 'true');
  assert.equal(
    input.hasAttribute('aria-invalid'),
    false,
    'quiet until visited',
  );
  const error = wrap.querySelector('.inline-error');
  assert.equal(error.hidden, true);
  assert.equal(
    error.getAttribute('role'),
    'status',
    'a hint while typing is polite, not an alert',
  );
});

test('leaving a required field empty flags it, without moving focus', () => {
  const wrap = fieldText('Title', '', () => {}, { required: true });
  document.body.append(wrap);
  const input = wrap.querySelector('input');
  const elsewhere = h('button', { type: 'button', text: 'Next' });
  document.body.append(elsewhere);
  elsewhere.focus();
  blur(input);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  const error = wrap.querySelector('.inline-error');
  assert.equal(error.hidden, false);
  assert.equal(
    input.getAttribute('aria-describedby'),
    error.id,
    'the control points at its message',
  );
  assert.equal(document.activeElement, elsewhere, 'focus stayed where it was');
});

test('whitespace does not count as filled in', () => {
  const wrap = fieldText('Title', '', () => {}, { required: true });
  const input = wrap.querySelector('input');
  type(input, '   ');
  blur(input);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
});

test('the flag clears as soon as a value is typed, without another blur', () => {
  const wrap = fieldText('Title', '', () => {}, { required: true });
  const input = wrap.querySelector('input');
  blur(input);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  type(input, 'Hello');
  assert.equal(input.hasAttribute('aria-invalid'), false);
  assert.equal(input.hasAttribute('aria-describedby'), false);
  assert.equal(wrap.querySelector('.inline-error').hidden, true);
});

test('a field that already has a value is never flagged', () => {
  const wrap = fieldText('Title', 'Present', () => {}, { required: true });
  blur(wrap.querySelector('input'));
  assert.equal(wrap.querySelector('input').hasAttribute('aria-invalid'), false);
});

test('markdown fields get the same treatment', () => {
  const wrap = fieldMarkdown('Body', '', 'help', () => {}, { required: true });
  const ta = wrap.querySelector('textarea');
  assert.ok(wrap.querySelector('.field-required-mark'));
  blur(ta);
  assert.equal(ta.getAttribute('aria-invalid'), 'true');
});

test("a read-only code field is not the author's to fill in, so it is not flagged", () => {
  const wrap = fieldCode('HTML', '', 'help', () => {}, {
    required: true,
    readOnly: true,
  });
  assert.equal(wrap.classList.contains('is-required'), false);
  assert.equal(wrap.querySelector('.inline-error'), null);
});

test('emptyRequiredFields finds the empty ones only', () => {
  const root = h('div', {}, [
    fieldText('A', '', () => {}, { required: true }),
    fieldText('B', 'filled', () => {}, { required: true }),
    fieldText('C', '', () => {}),
    fieldMarkdown('D', '  ', 'help', () => {}, { required: true }),
  ]);
  const labels = emptyRequiredFields(root).map((w) =>
    w.querySelector('.field-label').textContent.replace(/\*/g, ''),
  );
  assert.deepEqual(labels, ['A', 'D']);
});
