/**
 * The slide list is one Tab stop (B726, D349): the active row carries the
 * roving tabindex, the buttons inside a row stay out of the Tab order, arrows
 * (and Home/End) walk the slides and never the "+" insert rows, Enter or the
 * menu key opens the row's actions, and the visibility presets are reachable
 * through that menu with the focus following.
 *
 * jsdom has no native Tab, so `pressTab` moves the focus over the tabbable
 * elements in DOM order, as a browser does when no handler takes the key.
 *
 * Run with: node --test tests/slide-list-roving-tab.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
// Frames run when the test flushes them, after the re-render they wait for.
let frames = [];
globalThis.requestAnimationFrame = (fn) => frames.push(fn);
globalThis.cancelAnimationFrame = () => {};
const flush = () => {
  for (let i = 0; i < 5 && frames.length; i++) {
    const run = frames;
    frames = [];
    run.forEach((fn) => fn());
  }
};

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { setupSlideList } =
  await import('../client/views/editor/slide-list/index.js');
const { closeSlideContextMenu } =
  await import('../client/views/editor/slide-list/context-menu.js');
const { closeVisibilityMenu } =
  await import('../client/views/editor/slide-visibility-menu.js');

function deck() {
  return {
    id: 'deck-roving',
    slides: [
      { id: 'a', type: 'title', parentId: null, content: { title: 'A' } },
      { id: 'p', type: 'title', parentId: null, content: { title: 'P' } },
      { id: 'c', type: 'title', parentId: 'p', content: { title: 'C' } },
      { id: 'z', type: 'title', parentId: null, content: { title: 'Z' } },
    ],
  };
}

/** A button before and after the list, and the list wired as the editor does. */
function mount({ selected = 'a', query = '' } = {}) {
  localStorage.clear();
  const pres = deck();
  const before = document.createElement('button');
  before.textContent = 'before';
  const listEl = document.createElement('div');
  const after = document.createElement('button');
  after.textContent = 'after';
  document.body.append(before, listEl, after);

  let selectedId = selected;
  let multi = new Set();
  const editorState = { refreshAll: () => list.rerenderSlideList() };
  const list = setupSlideList({
    slideListEl: listEl,
    pres,
    getSelectedSlideId: () => selectedId,
    setSelectedSlideId: (id) => {
      selectedId = id;
    },
    getSelectedSlideIds: () => multi,
    setSelectedSlideIds: (ids) => {
      multi = new Set(ids);
    },
    clearMultiSelection: () => {
      multi = new Set();
    },
    onMultiSelectionChange: () => {},
    SLIDE_TYPES,
    renderSlideElement: () => document.createElement('div'),
    editorState,
    markDirty: () => {},
    rerenderEditor: () => {},
    rerenderPreview: () => {},
    onRequestInsert: () => {},
    getSearchQuery: () => query,
    isAuthor: () => true,
  });
  list.rerenderSlideList();
  return {
    pres,
    before,
    after,
    listEl,
    selected: () => selectedId,
    row: (id) => listEl.querySelector(`.slide-item[data-slide-id="${id}"]`),
    teardown: () => {
      closeSlideContextMenu();
      closeVisibilityMenu();
      list.detach();
      before.remove();
      listEl.remove();
      after.remove();
      flush();
    },
  };
}

function isTabbable(el) {
  if (el.disabled || el.hidden) return false;
  if (el.hasAttribute('tabindex')) return el.tabIndex >= 0;
  return el.matches('button, input, textarea, select, a[href]');
}

function pressTab() {
  const from = document.activeElement;
  const all = [...document.body.querySelectorAll('*')].filter(
    (el) => el === from || isTabbable(el),
  );
  all[all.indexOf(from) + 1]?.focus();
}

function press(key, opts = {}) {
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    }),
  );
  flush();
}

const focusedSlide = () => document.activeElement?.dataset?.slideId || null;

test('Tab crosses the slide list in one stop, on the active row', () => {
  const env = mount({ selected: 'p' });
  try {
    env.before.focus();
    const seen = [];
    for (let i = 0; i < 10 && document.activeElement !== env.after; i++) {
      pressTab();
      seen.push(focusedSlide() || document.activeElement.textContent);
    }
    assert.deepEqual(seen, ['p', 'after']);
    const stops = [...env.listEl.querySelectorAll('*')].filter(isTabbable);
    assert.deepEqual(
      stops.map((el) => el.dataset.slideId),
      ['p'],
      'no ⋯, eye, fold or + button is a Tab stop',
    );
  } finally {
    env.teardown();
  }
});

test('arrows, Home and End walk the slides, not the + rows', () => {
  const env = mount({ selected: 'a' });
  try {
    env.row('a').focus();
    press('ArrowDown');
    assert.equal(env.selected(), 'p');
    assert.equal(focusedSlide(), 'p');
    assert.equal(env.row('p').tabIndex, 0);
    assert.equal(env.row('a').tabIndex, -1);
    press('ArrowDown');
    assert.equal(focusedSlide(), 'c', 'a child row is a stop of the walk');
    press('End');
    assert.equal(focusedSlide(), 'z');
    press('ArrowDown');
    assert.equal(focusedSlide(), 'z', 'the walk stops at the last slide');
    press('Home');
    assert.equal(focusedSlide(), 'a');
    assert.equal(
      env.listEl.querySelectorAll('.slide-item[tabindex="0"]').length,
      1,
    );
  } finally {
    env.teardown();
  }
});

test('Left folds a parent, Right unfolds it, and the walk skips its children', () => {
  const env = mount({ selected: 'p' });
  try {
    env.row('p').focus();
    press('ArrowLeft');
    assert.equal(focusedSlide(), 'p');
    assert.ok(env.row('c').classList.contains('is-hidden'));
    press('ArrowDown');
    assert.equal(focusedSlide(), 'z', 'a folded child is not walked');
    press('ArrowUp');
    press('ArrowRight');
    assert.ok(!env.row('c').classList.contains('is-hidden'));
    press('ArrowDown');
    assert.equal(focusedSlide(), 'c');
  } finally {
    env.teardown();
  }
});

test('Enter opens the row menu with the focus in it; Escape returns to the row', () => {
  const env = mount({ selected: 'a' });
  try {
    env.row('z').focus();
    press('Enter');
    const menu = document.querySelector('.slide-context-menu');
    assert.ok(menu, 'Enter opens the slide menu');
    assert.equal(env.selected(), 'z', 'the menu acts on the focused slide');
    assert.ok(menu.contains(document.activeElement), 'focus is in the menu');
    press('Escape');
    assert.equal(document.querySelector('.slide-context-menu'), null);
    assert.equal(focusedSlide(), 'z');
  } finally {
    env.teardown();
  }
});

test('the menu key opens the menu once, despite the contextmenu after it', () => {
  const env = mount({ selected: 'a' });
  try {
    env.row('a').focus();
    press('ContextMenu');
    const menu = document.querySelector('.slide-context-menu');
    assert.ok(menu);
    env
      .row('a')
      .dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
    assert.equal(document.querySelector('.slide-context-menu'), menu);
    press('Escape');
    env.row('a').focus();
    press('F10', { shiftKey: true });
    assert.ok(document.querySelector('.slide-context-menu'), 'Shift+F10 too');
  } finally {
    env.teardown();
  }
});

test('visibility is reached through the menu, focus on the presets and back', async () => {
  const env = mount({ selected: 'a' });
  try {
    env.row('a').focus();
    press('Enter');
    const visItem = [
      ...document.querySelectorAll('.slide-context-menu-item'),
    ].find((el) => /visibility/i.test(el.textContent));
    assert.ok(visItem, 'the menu carries Change visibility');
    visItem.click();
    flush();
    const vm = document.querySelector('.visibility-menu-option')?.parentElement;
    assert.ok(vm, 'the presets open');
    assert.ok(
      document.activeElement.classList.contains('visibility-menu-option'),
      'a preset has the focus',
    );
    press('Escape');
    assert.equal(document.querySelector('.visibility-menu-option'), null);
    assert.equal(focusedSlide(), 'a');

    // A pick re-renders the list; the focus lands on the new row.
    press('Enter');
    [...document.querySelectorAll('.slide-context-menu-item')]
      .find((el) => /visibility/i.test(el.textContent))
      .click();
    flush();
    [...document.querySelectorAll('.visibility-menu-option')]
      .find((el) => /hidden/i.test(el.textContent))
      .click();
    flush();
    assert.equal(focusedSlide(), 'a');
    // The presets close after a short beat of feedback.
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(document.querySelector('.visibility-menu-option'), null);
    assert.notEqual(env.pres.slides[0].visibility, undefined);
  } finally {
    env.teardown();
  }
});

test('with the active slide off screen, the first row is the stop', () => {
  const env = mount({ selected: 'gone' });
  try {
    const stops = [...env.listEl.querySelectorAll('.slide-item')].filter(
      (el) => el.tabIndex === 0,
    );
    assert.deepEqual(
      stops.map((el) => el.dataset.slideId),
      ['a'],
    );
  } finally {
    env.teardown();
  }
});
