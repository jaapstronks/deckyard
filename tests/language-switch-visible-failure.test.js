/**
 * The language switch may never fail silently.
 *
 * Three regressions are pinned here, all from the same report ("the EN button
 * does nothing"):
 *  1. a rejection with no message at all still produces a visible toast
 *     (`toastStatus` used to `return` on an empty message - the code caught the
 *     error, decided to show it, and then showed nothing);
 *  2. a throw from the part of the switch that sits outside the inner
 *     try/catch reaches the user instead of becoming an unhandled rejection;
 *  3. while a translation runs the language buttons are disabled and say why,
 *     rather than silently swallowing clicks under the busy modal's backdrop.
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
// The busy modal goes through createModal → createFocusTrap, which schedules
// its initial focus on a frame.
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;

const { normalizeLang, otherLang } =
  await import('../client/lib/format/i18n.js');
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
    otherLang,
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
  const [btnNl, btnEn] = controller.el.querySelectorAll('.sb-segmented-btn');
  return {
    controller,
    pres,
    toasts,
    btnNl,
    btnEn,
    seg: controller.el.querySelector('.sb-segmented'),
  };
}

test('a rejection without a message still surfaces a toast', async () => {
  // The sharpest silent path: the message ends up empty, so the old
  // `if (!msg) return;` in toastStatus threw the only user-visible signal away.
  const { toasts, btnEn } = mount({
    api: async () => {
      throw '';
    },
  });

  btnEn.click();
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
  // catch this vanished as an unhandled rejection and left a dead button.
  const { toasts, btnEn } = mount({
    api: async () => ({
      i18n: { versions: {} },
      title: 'Deck',
      slides: [],
      theme: null,
    }),
  });

  btnEn.click();
  await flush();

  const errors = toasts.filter((x) => x.level === 'error');
  assert.equal(errors.length, 1, 'the failure is reported');
  assert.ok(errors[0].msg.trim(), 'with a non-empty message');
});

test('language buttons are disabled with a reason while translating', async () => {
  let release;
  const { toasts, btnNl, btnEn, seg, controller } = mount({
    api: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const idleTitle = seg.title;

  assert.equal(btnEn.disabled, false, 'enabled while idle');

  const running = controller.translateOtherLanguage();
  await flush();

  assert.equal(btnNl.disabled, true, 'NL disabled while translating');
  assert.equal(btnEn.disabled, true, 'EN disabled while translating');
  assert.equal(seg.getAttribute('aria-busy'), 'true');
  assert.notEqual(seg.title, idleTitle, 'the control explains why it is inert');
  assert.match(seg.title, /translat/i);

  release({ presentation: { revision: 2 } });
  await running;

  assert.equal(
    btnEn.disabled,
    false,
    'released again when the translation ends',
  );
  assert.equal(seg.getAttribute('aria-busy'), 'false');
  assert.equal(seg.title, idleTitle, 'idle title restored');
  assert.ok(
    toasts.some((x) => x.level === 'success'),
    'and the result is reported',
  );
});
