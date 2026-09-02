/**
 * The toast primitive: which live region announces what, keyboard dismissal,
 * pause on hover, and the one spelling per kind (B203).
 *
 * Before this, every toast was a `role="status"` inside a single polite region
 * that was created lazily and filled in the same tick — a failure sounded like
 * "Saved" and, classically, was often not announced at all. Nothing dismissed
 * from the keyboard, the timer ran through a hover, and `classifyType`
 * accepted four aliases that `tests/toast-call-shape.test.js` already forbade.
 *
 * Run with: node --test tests/toast-primitive.test.js
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

const { toast } = await import('../client/lib/dom/toast.js');

const politeRegion = () =>
  document.querySelector('.toast-region[role="status"]');
const assertiveRegion = () =>
  document.querySelector('.toast-region[role="alert"]');

/** Text of every toast currently inside a region. */
function textsIn(region) {
  return [...region.querySelectorAll('.toast .toast-text')].map(
    (el) => el.textContent,
  );
}

/** The toast element carrying a given text, wherever it sits. */
function toastWithText(text) {
  return [...document.querySelectorAll('.toast')].find(
    (el) => el.querySelector('.toast-text')?.textContent === text,
  );
}

/** Take every toast off screen through the real dismissal path. */
function clear() {
  for (const el of [...document.querySelectorAll('.toast')]) {
    el.click();
    el.remove();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function press(el, key) {
  el.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Dispatch a non-bubbling pointer event straight at the toast. */
function pointer(el, type) {
  el.dispatchEvent(new dom.window.Event(type));
}

test('both live regions exist before the first toast is shown', () => {
  // A region created and filled in the same tick is the classic "never
  // announced" case, so importing the module must be enough to build them.
  assert.ok(politeRegion(), 'a polite region is in the document');
  assert.ok(assertiveRegion(), 'an assertive region is in the document');
  assert.equal(politeRegion().getAttribute('aria-live'), 'polite');
  assert.equal(assertiveRegion().getAttribute('aria-live'), 'assertive');
  // role=status/alert imply an atomic region; that would re-announce every
  // toast still on screen each time one arrives.
  assert.equal(politeRegion().getAttribute('aria-atomic'), 'false');
  assert.equal(assertiveRegion().getAttribute('aria-atomic'), 'false');
});

test('confirmations announce politely, failures assertively', () => {
  toast.success('Saved', { id: 'aria-success' });
  toast.info('Converting…', { id: 'aria-info' });
  toast.error('Request failed (500)', { id: 'aria-error' });
  toast.warning('Nearly out of room', { id: 'aria-warning' });

  assert.deepEqual(textsIn(politeRegion()), ['Saved', 'Converting…']);
  assert.deepEqual(textsIn(assertiveRegion()), [
    'Request failed (500)',
    'Nearly out of room',
  ]);
  clear();
});

test('a toast that changes kind moves to the region that fits it', () => {
  toast.info('Saving changes…', { id: 'kind-move' });
  assert.equal(politeRegion().querySelectorAll('.toast').length, 1);
  toast.error('Saving failed', { id: 'kind-move' });
  assert.equal(politeRegion().querySelectorAll('.toast').length, 0);
  assert.deepEqual(textsIn(assertiveRegion()), ['Saving failed']);
  clear();
});

test('Escape and Enter dismiss the focused toast', () => {
  toast.error('Escapable', { id: 'kb-escape' });
  const el = toastWithText('Escapable');
  el.focus();
  press(el, 'Escape');
  assert.ok(el.classList.contains('is-leaving'), 'Escape dismissed it');

  toast.success('Enterable', { id: 'kb-enter' });
  const el2 = toastWithText('Enterable');
  el2.focus();
  press(el2, 'Enter');
  assert.ok(el2.classList.contains('is-leaving'), 'Enter dismissed it');
  clear();
});

test('a key pressed inside the action button does not dismiss the toast', () => {
  toast.info('With action', {
    id: 'kb-action',
    action: { label: 'Undo', onClick: () => {} },
  });
  const el = toastWithText('With action');
  const btn = el.querySelector('.toast-action');
  press(btn, 'Enter');
  assert.equal(
    el.classList.contains('is-leaving'),
    false,
    'Enter on the button is the button’s business',
  );
  press(btn, 'Escape');
  assert.ok(
    el.classList.contains('is-leaving'),
    'Escape anywhere inside the toast still closes it',
  );
  clear();
});

test('hovering pauses the timer and leaving resumes it', async () => {
  toast.info('Hoverable', { id: 'pause-hover', durationMs: 40 });
  const el = toastWithText('Hoverable');
  pointer(el, 'mouseenter');
  await sleep(120);
  assert.equal(
    el.classList.contains('is-leaving'),
    false,
    'the timer does not run while the pointer is on the toast (WCAG 1.4.13)',
  );
  pointer(el, 'mouseleave');
  await sleep(120);
  assert.ok(el.classList.contains('is-leaving'), 'leaving resumes the timer');
  clear();
});

test('a toast carrying an action does not expire on its own', async () => {
  toast.success('Deleted', {
    id: 'action-persist',
    durationMs: 30,
    action: { label: 'Undo', onClick: () => {} },
  });
  const el = toastWithText('Deleted');
  await sleep(120);
  assert.equal(
    el.classList.contains('is-leaving'),
    false,
    'an action must be reachable before the toast goes (WCAG 2.2.1)',
  );
  clear();
});

test('one spelling per kind — the old aliases are gone', () => {
  for (const alias of ['danger', 'fail', 'ok', 'warn', 'ERROR']) {
    assert.throws(
      () => toast('x', { type: alias }),
      /Unknown toast type/,
      `${alias} is not a spelling of any kind`,
    );
  }
  for (const type of ['info', 'success', 'warning', 'error']) {
    toast('x', { type, id: `spell-${type}` });
    assert.ok(
      document.querySelector(`.toast.toast-${type}`),
      `${type} renders as itself`,
    );
    clear();
  }
});

test('a DOM element as message is refused instead of rendering "{}"', () => {
  // client/views/list/presentation-card.js used to hand a <span> with a link to
  // toast.success; JSON.stringify turned it into `{}` on screen. A link belongs
  // in the `action` option.
  const el = document.createElement('span');
  el.textContent = 'Restored. Open presentation';
  assert.throws(
    () => toast.success(el),
    /must be a string or an Error/,
    'a DOM element is a programming error, not a message',
  );
  assert.throws(() => toast.info({ message: 'nope' }), /must be a string/);
  // Strings and Errors still pass through.
  toast.info('plain', { id: 'coerce-ok' });
  assert.ok(toastWithText('plain'));
  clear();
});
