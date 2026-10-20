/**
 * The language switch may never fail silently.
 *
 * Two regressions are pinned here, all from the same report ("the EN button
 * does nothing"):
 *  1. a rejection with no message at all still produces a visible toast
 *     (`toastStatus` used to `return` on an empty message - the code caught the
 *     error, decided to show it, and then showed nothing);
 *  2. a throw from the part of the switch that sits outside the inner
 *     try/catch reaches the user instead of becoming an unhandled rejection;
 *
 * The control they were reported against was a fixed NL/EN segmented toggle; it
 * is now a language menu over every version the deck has (B182, phase 2). The
 * failure modes are the switch's, not the widget's, so they are pinned here in
 * the menu's shape.
 *
 * Run with: node --test tests/language-switch-visible-failure.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/p1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;

const { normalizeLang } = await import('../client/lib/format/i18n.js');
const { setFeatures } = await import('../client/lib/state/features.js');
// The translation this file drives is an AI action: it is only reachable where
// AI is on (D179).
setFeatures({ enableAi: true });
const { createLanguageMode } =
  await import('../client/views/editor/topbar/language-mode.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Deck with a Dutch version only, so switching to EN creates one. */
function makePres() {
  return {
    id: 'p1',
    title: 'Deck',
    slides: [],
    theme: null,
    revision: 1,
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: { nl: { title: 'Deck', slides: [] } },
    },
  };
}

function mount({ api, pres = makePres() }) {
  const toasts = [];
  const record = (level) => (msg) => toasts.push({ level, msg });
  const controller = createLanguageMode({
    root: document.body,
    pres,
    id: 'p1',
    api,
    requestSave: async () => {},
    isDirty: () => false,
    markDirty: () => {},
    normalizeLang,
    getSelectedSlideId: () => null,
    setSelectedSlideId: () => {},
    editorState: { refreshAll: () => {} },
    topbarTitleEl: null,
    toast: {
      info: record('info'),
      success: record('success'),
      error: record('error'),
    },
  });
  document.body.replaceChildren(controller.el);
  const items = () => [...controller.el.querySelectorAll('.lang-menu-item')];
  /** The menu row for one language, by its native label. */
  const item = (label) =>
    items().find((b) =>
      b.querySelector('.lang-menu-name')?.textContent === label
        ? true
        : b.textContent.trim() === label,
    );
  return {
    controller,
    pres,
    toasts,
    items,
    item,
    trigger: controller.el.querySelector('.dropdown-trigger'),
  };
}

test('a rejection without a message still surfaces a toast', async () => {
  // The sharpest silent path: the message ends up empty, so the old
  // `if (!msg) return;` in toastStatus threw the only user-visible signal away.
  const { toasts, item } = mount({
    api: async () => {
      throw '';
    },
  });

  item('English').click();
  await flush();

  assert.equal(toasts.length, 1, 'exactly one toast');
  assert.equal(toasts[0].level, 'error', 'reported as an error, not as info');
  assert.equal(
    toasts[0].msg,
    'Unknown error',
    'falls back to a readable message',
  );
});

test('a throw past the inner catch is caught by switchLanguageMode', async () => {
  // The server answers, but without the version buffer the switch then writes
  // into - a TypeError outside loadLanguageIntoView's try. Before the wrapping
  // catch this vanished as an unhandled rejection and left a dead menu.
  const { toasts, item } = mount({
    api: async () => ({
      i18n: { versions: {} },
      title: 'Deck',
      slides: [],
      theme: null,
    }),
  });

  item('English').click();
  await flush();

  const errors = toasts.filter((x) => x.level === 'error');
  assert.equal(errors.length, 1, 'the failure is reported');
  assert.ok(errors[0].msg.trim(), 'with a non-empty message');
});
