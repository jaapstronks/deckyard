/**
 * The shared "forget me" button (`client/lib/format/analytics-erase-button.js`).
 *
 * The button is the client half of the anonymous erasure route: confirm →
 * `tracker.erase()` → toast + self-remove. This drives that handler under jsdom
 * — the same code path a real click runs — so the flow is covered without a
 * browser. The server half is pinned separately in
 * `tests/analytics-track-erase.test.js`.
 *
 * Three rules:
 *   1. **No tracker, no button.** With analytics off there is nothing to erase,
 *      so the factory returns null and a caller can guard on it.
 *   2. **Cancel erases nothing.** Dismissing the confirm leaves the button in
 *      place and never calls `erase()`.
 *   3. **Confirm erases, then removes itself.** A confirmed, successful erase
 *      calls `erase()` once, removes the button, and fires `onErased` so a later
 *      re-render does not resurrect a dead control. A failed erase leaves the
 *      button clickable again.
 *
 * Run with: node --test tests/analytics-erase-button.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/share/abc',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.getComputedStyle = dom.window.getComputedStyle;
// The modal helpers focus-trap on open, which schedules through rAF.
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);

const { createEraseMyDataButton } =
  await import('../client/lib/format/analytics-erase-button.js');

const LABELS = {
  button: 'Forget me',
  tooltip: 'Erase the view history recorded for this device',
  confirmTitle: 'Forget this device?',
  confirmMessage:
    'This permanently erases the viewing history for this device.',
  confirmOk: 'Forget me',
  cancel: 'Cancel',
  done: 'Erased.',
  failed: 'Could not erase.',
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The confirm modal's two action buttons, in DOM order [cancel, confirm]. */
function modalActions() {
  return [...document.querySelectorAll('.modal-actions button')];
}

test.afterEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Rule 1 — no tracker, no button
// ---------------------------------------------------------------------------

test('returns null when there is no tracker', () => {
  assert.equal(
    createEraseMyDataButton({ tracker: null, labels: LABELS }),
    null,
  );
  assert.equal(createEraseMyDataButton({ labels: LABELS }), null);
});

// ---------------------------------------------------------------------------
// Rule 2 — cancel erases nothing
// ---------------------------------------------------------------------------

test('cancelling the confirm leaves the button and never erases', async () => {
  let calls = 0;
  const tracker = {
    erase: async () => {
      calls++;
      return { ok: true };
    },
  };
  const btn = createEraseMyDataButton({ tracker, labels: LABELS });
  document.body.appendChild(btn);

  btn.click();
  await tick();
  const [cancel] = modalActions();
  assert.ok(cancel, 'the confirm modal opened');
  cancel.click();
  await tick();
  await tick();

  assert.equal(calls, 0, 'erase() was not called');
  assert.ok(btn.isConnected, 'the button is still in the DOM');
  assert.equal(btn.disabled, false, 'and still enabled');
});

// ---------------------------------------------------------------------------
// Rule 3 — confirm erases, then removes itself
// ---------------------------------------------------------------------------

test('confirming erases, removes the button, and fires onErased', async () => {
  let calls = 0;
  let erasedFired = 0;
  const tracker = {
    erase: async () => {
      calls++;
      return { ok: true };
    },
  };
  const btn = createEraseMyDataButton({
    tracker,
    labels: LABELS,
    onErased: () => {
      erasedFired++;
    },
  });
  document.body.appendChild(btn);

  btn.click();
  await tick();
  const confirm = modalActions().find((b) =>
    b.classList.contains('btn-danger'),
  );
  assert.ok(confirm, 'the confirm modal has a danger-styled confirm button');
  confirm.click();
  await tick();
  await tick();

  assert.equal(calls, 1, 'erase() was called exactly once');
  assert.equal(
    erasedFired,
    1,
    'onErased fired so a re-render will not rebuild it',
  );
  assert.equal(btn.isConnected, false, 'the button removed itself');
  assert.ok(document.querySelector('.toast-stack'), 'a toast was shown');
});

test('a failed erase leaves the button clickable again', async () => {
  const tracker = { erase: async () => ({ ok: false }) };
  let erasedFired = 0;
  const btn = createEraseMyDataButton({
    tracker,
    labels: LABELS,
    onErased: () => {
      erasedFired++;
    },
  });
  document.body.appendChild(btn);

  btn.click();
  await tick();
  modalActions()
    .find((b) => b.classList.contains('btn-danger'))
    .click();
  await tick();
  await tick();

  assert.ok(btn.isConnected, 'the button stays so the viewer can retry');
  assert.equal(btn.disabled, false, 're-enabled after the failure');
  assert.equal(erasedFired, 0, 'onErased did not fire on failure');
});
