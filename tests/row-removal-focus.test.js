/**
 * A row that disappears hands focus back to its list (B647).
 *
 * Deleting a theme, a custom slide type, a font family, a user, a collection
 * or a trashed deck used to leave focus on `<body>`: the control that was
 * clicked lived in the row, `createOverlay` hands focus back to it when the
 * confirm dialog closes, and the re-render removes it. For the eye nothing is
 * wrong — the row is gone, which is why the confirmation toast was right to go
 * (B643). For a keyboard or screen-reader user the list is left, the position
 * is lost and nothing is said.
 *
 * Pinned here: the planner's three cases (a next row, the last row, an emptied
 * list), the shared polite region, and the themes tab as the one real list
 * driven end to end — a theme deleted through the tab's own menu leaves focus
 * on the card that took its place, not on `<body>`.
 *
 * Run with: node --test tests/row-removal-focus.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/settings',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.SVGElement = dom.window.SVGElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.requestAnimationFrame = (fn) => {
  fn();
  return 0;
};

const { planRowRemoval, announcePolitely, __resetRowRemovalForTests } =
  await import('../client/lib/dom/row-removal.js');

/** Let the announcement's own task run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/**
 * A list of `count` rows, each holding a button, plus a "new" button beside it.
 * @param {number} count
 */
function makeList(count) {
  const wrap = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'rows';
  for (let i = 0; i < count; i += 1) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.label = `row-${i}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    row.append(btn);
    list.append(row);
  }
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'new';
  wrap.append(list, newBtn);
  document.body.append(wrap);
  return { wrap, list, newBtn };
}

test.beforeEach(() => {
  document.body.innerHTML = '';
  __resetRowRemovalForTests();
});

// ------------------------------------------------------------- the three cases

test('focus lands on the row that took the place of the removed one', () => {
  const { list } = makeList(3);
  const land = planRowRemoval(list, { index: 1 });
  list.children[1].remove(); // the middle row goes
  land();
  assert.equal(document.activeElement?.dataset.label, 'row-2');
});

test('removing the last row lands focus on the one before it', () => {
  const { list } = makeList(3);
  const land = planRowRemoval(list, { index: 2 });
  list.children[2].remove();
  land();
  assert.equal(document.activeElement?.dataset.label, 'row-1');
});

test('a list that puts its own note where the rows were lands on the note', () => {
  // The collections bar's shape: the empty note is a child of the list, so it
  // is what took the removed chip's place, and reading it says what the list
  // is for. Verified in the browser on /app/slide-library.
  const { list, newBtn } = makeList(1);
  const land = planRowRemoval(list, { index: 0, fallback: newBtn });
  list.children[0].remove();
  const note = document.createElement('div');
  note.className = 'empty-note';
  note.dataset.label = 'note';
  list.append(note);
  land();
  assert.equal(document.activeElement, note);
  assert.equal(note.getAttribute('tabindex'), '-1');
});

test('a list left with nothing lands focus on the control the caller names', () => {
  const { list, newBtn } = makeList(1);
  const land = planRowRemoval(list, { index: 0, fallback: newBtn });
  list.children[0].remove();
  land();
  assert.equal(document.activeElement, newBtn);
});

test('a list rebuilt by the render is read back through its getter', () => {
  const { wrap } = makeList(2);
  const land = planRowRemoval(() => wrap.querySelector('.rows'), { index: 0 });
  // What a re-render does: the old list element is replaced wholesale.
  wrap.querySelector('.rows')?.remove();
  const fresh = document.createElement('div');
  fresh.className = 'rows';
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.label = 'row-1';
  fresh.append(row);
  wrap.prepend(fresh);
  land();
  assert.equal(document.activeElement?.dataset.label, 'row-1');
});

test('a row that was not built to be focused is focused by script only', () => {
  const { list } = makeList(2);
  planRowRemoval(list, { index: 0 })();
  const focused = /** @type {Element} */ (document.activeElement);
  assert.equal(focused.getAttribute('tabindex'), '-1');
  // Script-only: it must not join the tab order.
  assert.notEqual(focused.getAttribute('tabindex'), '0');
});

// ------------------------------------------------------------- the announcement

test('the removal is announced once, politely, in one shared region', async () => {
  const { list } = makeList(2);
  planRowRemoval(list, { index: 0 })('Sunset removed.');
  await tick();

  const regions = document.querySelectorAll('[aria-live]');
  assert.equal(regions.length, 1);
  const region = regions[0];
  assert.equal(region.getAttribute('aria-live'), 'polite');
  assert.equal(region.getAttribute('role'), 'status');
  assert.equal(region.className, 'sr-only');
  assert.equal(region.textContent, 'Sunset removed.');

  // A second removal reuses the region; the same sentence twice still changes
  // it, or a screen reader would stay silent on the repeat.
  announcePolitely('Sunset removed.');
  assert.equal(region.textContent, '');
  await tick();
  assert.equal(document.querySelectorAll('[aria-live]').length, 1);
  assert.equal(region.textContent, 'Sunset removed.');
});

test('no sentence means no announcement, only focus', async () => {
  const { list } = makeList(2);
  const land = planRowRemoval(list, { index: 0 });
  list.children[0].remove();
  land();
  await tick();
  assert.equal(document.querySelector('[aria-live]'), null);
  assert.equal(document.activeElement?.dataset.label, 'row-1');
});

// --------------------------------------------- through the real confirm modal

test('the confirm dialog hands focus to a button that is about to go', async () => {
  const { confirmModal } = await import('../client/lib/dom/modal.js');
  const { list, newBtn } = makeList(3);

  // What a list does: the delete control sits in the row.
  const deleteBtn = /** @type {HTMLElement} */ (
    list.children[1].querySelector('button')
  );
  deleteBtn.focus();
  assert.equal(document.activeElement, deleteBtn);

  const pending = confirmModal(document.body, {
    title: 'Delete',
    message: 'Delete row-1?',
    confirmLabel: 'Delete',
    danger: true,
  });
  const confirmBtn = /** @type {HTMLElement|null} */ (
    document.querySelector('.modal-actions .btn-danger')
  );
  assert.ok(confirmBtn, 'the confirm dialog is on screen');
  confirmBtn.click();
  assert.equal(await pending, true);

  // The overlay restored focus to the row's own button (modal.js) — which the
  // re-render is about to take away. That is the whole defect.
  assert.equal(document.activeElement, deleteBtn);

  const land = planRowRemoval(list, { index: 1, fallback: newBtn });
  list.children[1].remove(); // the row, and the focused button with it
  assert.equal(document.activeElement, document.body, 'premise: focus is lost');

  land('row-1 removed.');
  await tick();
  const focused = /** @type {Element|null} */ (document.activeElement);
  assert.notEqual(focused, document.body);
  assert.equal(focused?.closest('.rows'), list, 'focus is back in the list');
  assert.equal(
    /** @type {HTMLElement} */ (focused).dataset.label,
    'row-2',
    'and on the row that took the place of the removed one',
  );
  assert.equal(
    document.querySelector('[aria-live]')?.textContent,
    'row-1 removed.',
  );
});
