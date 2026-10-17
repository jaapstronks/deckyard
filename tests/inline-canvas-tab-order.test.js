/**
 * The canvas fields in the Tab order (B725, D349).
 *
 * Between edits, every rendered field and every ghost of the slide is a Tab
 * stop, walked in schema order: from the slide bar Tab reaches the first
 * field, then each next stop, and past the last one the browser's own Tab
 * leaves the canvas for what follows it (here: the inspector). Enter on a
 * focused field edits it and selects it ("This text"); Escape cancels the
 * edit with the focus back on the field; Enter commits likewise. Tab inside
 * an edit keeps wrapping between the fields (B704, tab-order.js).
 *
 * jsdom has no native Tab, so `pressTab` dispatches the keydown and, when no
 * handler took it, moves the focus to the next tabbable element in document
 * order, as a browser does.
 *
 * Run with: node --test tests/inline-canvas-tab-order.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/p1',
  pretendToBeVisual: true,
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
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver =
  dom.window.IntersectionObserver || NoopObserver;
globalThis.ResizeObserver = dom.window.ResizeObserver || NoopObserver;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { renderSlideElement, NO_DECK_LANG } =
  await import('../client/lib/slide-runtime/slide-render.js');
const { createInlineEditor } =
  await import('../client/views/editor/inline-edit/inline-editor.js');

const settle = () => new Promise((r) => setTimeout(r, 5));

/**
 * The editor between a slide-bar button and an inspector button, as on the
 * editor page: the canvas sits between the two in document order.
 */
function mount(slide) {
  const slideBar = document.createElement('button');
  slideBar.textContent = 'slide bar';
  const stage = document.createElement('div');
  const thumb = document.createElement('div');
  stage.append(thumb);
  const inspector = document.createElement('button');
  inspector.textContent = 'inspector';
  document.body.append(slideBar, stage, inspector);
  let selected = null;
  let editor;
  const rerenderPreview = () => {
    if (editor.isEditing()) return;
    thumb.innerHTML = '';
    thumb.append(
      renderSlideElement(slide, { mode: 'edit', lang: NO_DECK_LANG }),
    );
    editor.refresh();
  };
  editor = createInlineEditor({
    thumb,
    previewStage: stage,
    getSlide: () => slide,
    getSlideDef: (type) => SLIDE_TYPES[type],
    getCanEdit: () => true,
    markDirty: () => {},
    rerenderPreview,
    openImagePicker: () => {},
    pres: { id: 'p1', slides: [slide] },
    onSelectElement: (el) => {
      selected = el || null;
    },
    getSelectedElement: () => selected,
  });
  rerenderPreview();
  return {
    slide,
    slideBar,
    inspector,
    selected: () => selected,
    field: (key) => thumb.querySelector(`[data-inline-field="${key}"]`),
    teardown: () => {
      editor.detach();
      slideBar.remove();
      stage.remove();
      inspector.remove();
    },
  };
}

function isTabbable(el) {
  if (el.disabled || el.hidden) return false;
  if (el.hasAttribute('tabindex')) return el.tabIndex >= 0;
  return el.matches('button, input, textarea, select, a[href]');
}

/** Tab as a browser does: a handler may take it, else the DOM order moves on. */
function pressTab(shift = false) {
  const from = document.activeElement;
  const e = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  from.dispatchEvent(e);
  if (e.defaultPrevented) return;
  const all = [...document.body.querySelectorAll('*')].filter(
    (el) => el === from || isTabbable(el),
  );
  const at = all.indexOf(from);
  all[at + (shift ? -1 : 1)]?.focus();
}

function press(key) {
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

/** What has the focus: a field path, a ghost path, or the button's text. */
function focused() {
  const el = document.activeElement;
  if (el.hasAttribute('data-inline-field'))
    return el.getAttribute('data-inline-field');
  if (el.hasAttribute('data-ie-ghost'))
    return `+${el.getAttribute('data-ie-ghost')}`;
  return `button:${el.textContent.trim()}`;
}

/** Tab from the slide bar until the inspector, collecting each stop. */
function tabWalk(env, shift = false) {
  (shift ? env.inspector : env.slideBar).focus();
  const seen = [];
  for (let i = 0; i < 30; i++) {
    pressTab(shift);
    seen.push(focused());
    if (document.activeElement === (shift ? env.slideBar : env.inspector))
      break;
  }
  return seen;
}

const TITLE = {
  id: 't',
  type: 'title-slide',
  content: { title: 'Hello', subheading: 'World' },
};

const LIST = {
  id: 'l',
  type: 'list-slide',
  content: {
    title: 'Points',
    items: [
      { title: 'One', text: 'First' },
      { title: 'Two', text: '' },
    ],
  },
};

/** The canvas stops of a walk: its fields and ghosts, not the other buttons. */
const canvasPart = (walk) => walk.filter((s) => !s.startsWith('button:'));

test('title slide: Tab from the slide bar reaches each field in schema order, then the inspector', () => {
  const env = mount(structuredClone(TITLE));
  try {
    const walk = tabWalk(env);
    assert.equal(walk.at(-1), 'button:inspector');
    assert.deepEqual(canvasPart(walk), ['title', 'subheading', '+meta']);
    // Leaving the canvas puts the roving stop back on the first field, so
    // the next walk from the slide bar starts there again, not where the last
    // one left off; Shift-Tab from the inspector enters on that same stop.
    assert.deepEqual(canvasPart(tabWalk(env)), [
      'title',
      'subheading',
      '+meta',
    ]);
    const back = tabWalk(env, true);
    assert.equal(back.at(-1), 'button:slide bar');
    assert.deepEqual(canvasPart(back), ['title']);
  } finally {
    env.teardown();
  }
});

test('list slide: items and their ghosts follow the schema, not the DOM', () => {
  const env = mount(structuredClone(LIST));
  try {
    assert.deepEqual(canvasPart(tabWalk(env)), [
      'title',
      '+subheading',
      'items.0.title',
      'items.0.text',
      'items.1.title',
      '+items.1.text',
    ]);
  } finally {
    env.teardown();
  }
});

test('one roving stop: only one canvas stop carries tabindex 0', () => {
  const env = mount(structuredClone(LIST));
  try {
    const roving = () =>
      [
        ...document.querySelectorAll('[data-inline-field], [data-ie-ghost]'),
      ].filter((el) => el.getAttribute('tabindex') === '0');
    assert.deepEqual(roving(), [env.field('title')]);
    env.slideBar.focus();
    pressTab();
    pressTab();
    pressTab();
    assert.deepEqual(roving(), [env.field('items.0.title')]);
  } finally {
    env.teardown();
  }
});

test('Enter edits the focused field and selects it; Escape returns the focus to it; Tab goes on', async () => {
  const env = mount(structuredClone(TITLE));
  try {
    env.slideBar.focus();
    pressTab();
    assert.equal(focused(), 'title');
    press('Enter');
    assert.equal(
      env.field('title').getAttribute('contenteditable'),
      'plaintext-only',
    );
    assert.deepEqual(env.selected(), { kind: 'text', fieldKey: 'title' });
    env.field('title').textContent = 'Changed';
    press('Escape');
    await settle();
    assert.equal(env.field('title').hasAttribute('contenteditable'), false);
    assert.equal(env.slide.content.title, 'Hello', 'Escape cancels');
    assert.equal(focused(), 'title', 'the focus is back on the field');
    assert.deepEqual(env.selected(), { kind: 'text', fieldKey: 'title' });
    pressTab();
    assert.equal(focused(), 'subheading');
  } finally {
    env.teardown();
  }
});

test('Enter commits an edit and the focus survives the remount', async () => {
  const env = mount(structuredClone(TITLE));
  try {
    env.field('subheading').focus();
    press('Enter');
    env.field('subheading').textContent = 'Changed';
    press('Enter');
    await settle();
    await settle();
    assert.equal(env.slide.content.subheading, 'Changed');
    assert.equal(focused(), 'subheading');
    pressTab();
    assert.equal(focused(), '+meta');
  } finally {
    env.teardown();
  }
});

test('Tab inside an edit still walks the fields and wraps (B704)', () => {
  const env = mount(structuredClone(TITLE));
  try {
    env.field('subheading').focus();
    press('Enter');
    pressTab(true);
    assert.equal(
      env.field('title').getAttribute('contenteditable'),
      'plaintext-only',
      'Shift-Tab in an edit edits the previous field',
    );
    pressTab(true);
    assert.notEqual(
      document.activeElement,
      env.slideBar,
      'Shift-Tab from the first field wraps instead of leaving the canvas',
    );
    assert.equal(env.field('title').hasAttribute('contenteditable'), false);
  } finally {
    env.teardown();
  }
});

/**
 * B732: an empty field is a stop too, and its placeholder is CSS a screen
 * reader does not hear, so it carries a name: the placeholder's words, or else
 * the field's label, in the UI language. A filled field reads its own text.
 */
const EMPTY_TITLE = {
  id: 'te',
  type: 'title-slide',
  content: { title: '', subheading: '' },
};
const EMPTY_LIST = {
  id: 'le',
  type: 'list-slide',
  content: { title: '', items: [{ title: '', text: 'First' }] },
};

/** The accessible name a walk meets on each canvas stop, in Tab order. */
function stopNames(env) {
  env.slideBar.focus();
  const names = [];
  for (let i = 0; i < 30; i++) {
    pressTab();
    const el = document.activeElement;
    if (el === env.inspector) break;
    names.push(el.getAttribute('aria-label') ?? `text:${el.textContent}`);
  }
  return names;
}

test('every canvas stop has a name: an empty field its placeholder or label, a filled one its text (B732)', () => {
  const title = mount(structuredClone(EMPTY_TITLE));
  try {
    assert.deepEqual(stopNames(title), [
      'Add Title',
      'Subtitle',
      'Detail line',
    ]);
  } finally {
    title.teardown();
  }
  const list = mount(structuredClone(EMPTY_LIST));
  try {
    // The empty first item title has no in-box placeholder: its label names
    // it. The "+ Add item" button after the list reads its own text.
    assert.deepEqual(stopNames(list), [
      'Add Title',
      'Subheading',
      'Title',
      'text:First',
      'text:+Add item',
    ]);
  } finally {
    list.teardown();
  }
});

test('the name goes once the field is filled, and stays off a filled field (B732)', async () => {
  const env = mount(structuredClone(EMPTY_TITLE));
  try {
    assert.equal(env.field('title').getAttribute('aria-label'), 'Add Title');
    env.field('title').focus();
    press('Enter');
    env.field('title').textContent = 'Now filled';
    press('Enter');
    await settle();
    await settle();
    assert.equal(env.slide.content.title, 'Now filled');
    assert.equal(env.field('title').hasAttribute('aria-label'), false);
  } finally {
    env.teardown();
  }
});

test('ghost chip and empty-field names follow the UI language (B732)', async () => {
  const { setUiLocale } = await import('../client/lib/ui-i18n.js');
  const fs = await import('node:fs/promises');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const file = new URL(`..${url}`, import.meta.url);
    try {
      const body = await fs.readFile(file, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
  await setUiLocale('nl', { persist: false, announce: false });
  const env = mount({
    id: 'c',
    type: 'chapter-title-slide',
    content: { title: '', subheading: '' },
  });
  try {
    const chip = document.querySelector('[data-ie-ghost="subheading"]');
    assert.equal(chip.getAttribute('aria-label'), 'Subkop');
    assert.equal(chip.querySelector('.ie-ghost-label').textContent, 'Subkop');
    assert.equal(
      env.field('title').getAttribute('aria-label'),
      'Titel toevoegen',
    );
  } finally {
    env.teardown();
    await setUiLocale('en', { persist: false, announce: false });
    globalThis.fetch = realFetch;
  }
});
