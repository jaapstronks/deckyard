/**
 * Slide search: the per-keystroke rerender is debounced.
 *
 * `applySearch` used to run synchronously on every `input` event, so typing an
 * 8-char query fired 8 full `rerenderSlideList()` rebuilds — ~137 ms of blocked
 * main thread on an 80-slide deck. The input path is now debounced (200 ms), so
 * a burst of keystrokes collapses into a single rebuild.
 *
 * The regression risk is the callers that must stay synchronous, so that is
 * what this pins:
 * - typing several characters quickly → exactly one rebuild, once the timer
 *   fires;
 * - the clear button and Escape render immediately (no wait), and cancel any
 *   keystroke render still queued;
 * - the programmatic entry (`setSearchQuery`, used by the AI-review path)
 *   renders immediately.
 *
 * Run with: node --test tests/slide-search-debounce.test.js
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
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);

const { createSlidesPanel } =
  await import('../client/views/editor/slides-panel.js');

/** Mount a slides panel wired to a rebuild counter. */
function mount() {
  let rebuilds = 0;
  const panel = createSlidesPanel({
    root: document.body,
    pres: { id: 'p1', slides: [{ id: 's1', type: 'text-slide', content: {} }] },
    user: {},
    api: async () => ({ items: [] }),
    features: {},
    theme: {},
    SLIDE_TYPES: {},
    disabledSlideTypes: [],
    editorState: { refreshAll() {}, dirtyRefreshAll() {} },
    rerenderSlideList: () => {
      rebuilds += 1;
      return { total: 1, shown: 1, query: '', matchedIds: [] };
    },
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: () => {},
    getSelectedSlideIds: () => new Set(),
    clearMultiSelection: () => {},
    openAiAppendWizardModal: () => {},
    openDeckOverview: () => {},
    isSlidesCollapsed: () => false,
    setSlidesCollapsed: () => {},
    isAuthor: () => true,
  });
  document.body.append(panel.leftEl);
  const input = panel.leftEl.querySelector('.slides-search-input');
  const clearBtn = panel.leftEl.querySelector('.slides-search-clear');
  return {
    panel,
    input,
    clearBtn,
    getRebuilds: () => rebuilds,
    detach: () => panel.leftEl.remove(),
  };
}

/** Simulate a keystroke: set the value, then dispatch the input event. */
function typeChar(input, value) {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

test('a burst of keystrokes collapses into a single rebuild', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { input, getRebuilds, detach } = mount();

  // Type "workshop" one character at a time, faster than the debounce window.
  const q = 'workshop';
  for (let i = 1; i <= q.length; i += 1) {
    typeChar(input, q.slice(0, i));
    t.mock.timers.tick(50); // 50 ms between keys — inside the 200 ms window
  }

  assert.equal(
    getRebuilds(),
    0,
    'nothing rebuilds while the user is still typing',
  );

  t.mock.timers.tick(200); // user pauses
  assert.equal(getRebuilds(), 1, 'exactly one rebuild fires after the pause');

  detach();
});

test('the clear button renders immediately, without waiting for a timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { input, clearBtn, getRebuilds, detach } = mount();

  typeChar(input, 'w'); // queue a debounced render
  clearBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.equal(getRebuilds(), 1, 'clear rebuilds synchronously');

  // The queued keystroke render must not fire on top of the clear.
  t.mock.timers.tick(500);
  assert.equal(getRebuilds(), 1, 'the cancelled keystroke render never fires');

  detach();
});

test('Escape renders immediately and cancels a pending keystroke render', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { input, getRebuilds, detach } = mount();

  typeChar(input, 'wo');
  input.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );

  assert.equal(getRebuilds(), 1, 'Escape rebuilds synchronously');
  t.mock.timers.tick(500);
  assert.equal(getRebuilds(), 1, 'no stale keystroke render afterwards');

  detach();
});

test('detach drops a queued keystroke render (editor unmount)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { panel, input, getRebuilds, detach } = mount();

  typeChar(input, 'wo'); // queue a debounced render
  panel.detach(); // editor unmounts before the timer fires

  t.mock.timers.tick(500);
  assert.equal(getRebuilds(), 0, 'no rerender of a torn-down editor');

  detach();
});

test('the programmatic entry (setSearchQuery) renders immediately', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { panel, getRebuilds, detach } = mount();

  panel.setSearchQuery('results');
  assert.equal(getRebuilds(), 1, 'setSearchQuery rebuilds synchronously');

  detach();
});
