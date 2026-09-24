/**
 * One fullscreen contract for the presenter and the published page (B275, D111).
 *
 * What went wrong: `/p/` inherited the presenter's fullscreen CSS but not the
 * JavaScript it leans on, so after F the bottom bar hung static below the
 * viewport (a scrollbar), and Safari's green button — no Fullscreen API —
 * changed nothing at all. The contract pinned here:
 *
 *   1. **One detector, one class.** The Fullscreen API or a window that fills
 *      the screen sets `html.is-fullscreen`; the CSS keys on that class alone,
 *      no `:fullscreen` second spelling.
 *   2. **`/p/` runs the presenter's modules**, inlined by the script chain, not
 *      a copy of its own.
 *   3. **Both bars are overlays**, hidden on entry, shown by pointer activity
 *      or keyboard focus inside a bar, never by navigation keys (a clicker
 *      would flash them on every slide), and hidden again after idle.
 *   4. **`?ui=min` stays out of it**: no bars, so no class and no autohide.
 *
 * Run with: node --test tests/published-fullscreen-chrome.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { buildStandaloneHtml } from '../server/export/html.js';
import {
  buildScriptChain,
  CLIENT_MODULE_NAMES,
} from '../server/utils/script-chain.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const deck = {
  id: 'd',
  title: 'Fullscreen',
  slides: [
    { id: 's1', type: 'payoff-slide', content: {} },
    { id: 's2', type: 'payoff-slide', content: {} },
  ],
};

const SCREEN = { width: 1920, height: 1080 };

/** Give a jsdom window a screen and a settable viewport size. */
function sizeWindow(window, { width, height }) {
  Object.defineProperty(window.screen, 'width', { value: SCREEN.width });
  Object.defineProperty(window.screen, 'height', { value: SCREEN.height });
  resize(window, { width, height }, { dispatch: false });
}

function resize(window, { width, height }, { dispatch = true } = {}) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    configurable: true,
  });
  if (dispatch) window.dispatchEvent(new window.Event('resize'));
}

async function publishedPage(t, { query = '' } = {}) {
  const html = await buildStandaloneHtml(repoRoot, deck, {
    context: 'published',
  });
  const dom = new JSDOM(html, {
    url: `http://localhost/p/abcd1234-fullscreen${query}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: (window) => sizeWindow(window, { width: 1280, height: 720 }),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const flush = () => new Promise((r) => window.setTimeout(r, 0));
  await flush();
  return {
    window,
    document,
    flush,
    html,
    root: document.documentElement,
    shell: document.querySelector('.presenter-shell'),
  };
}

test('the published page inlines the presenter modules, not a copy', async () => {
  assert.deepEqual(CLIENT_MODULE_NAMES, [
    'presenter-fullscreen',
    'chrome-autohide',
  ]);
  const html = await buildStandaloneHtml(repoRoot, deck, {
    context: 'published',
  });
  assert.match(
    html,
    /const createPresenterFullscreenController = \(\(\) => \{/,
  );
  assert.match(html, /const createChromeAutoHide = \(\(\) => \{/);
  assert.doesNotMatch(
    html,
    /d\.requestFullscreen/,
    'the old private toggle on <html> is gone',
  );
  assert.throws(
    () => buildScriptChain({ clientModules: ['presenter'] }),
    /unknown client module "presenter"/,
  );
});

test('fullscreen CSS keys on html.is-fullscreen only, both bars as overlays', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck, {
    context: 'published',
  });
  assert.doesNotMatch(
    html,
    /[\w\])]:fullscreen\b/,
    'no :fullscreen selector as a second spelling',
  );
  assert.match(
    html,
    /html\.is-fullscreen \{\s*--presenter-topbar-height: 0px;\s*overflow: hidden;/,
    'the root cannot scroll in fullscreen',
  );
  assert.match(
    html,
    /html\.is-fullscreen \.presenter-topbar,\s*html\.is-fullscreen \.presenter-progress \{[^}]*position: absolute;[^}]*opacity: 0;/,
  );
  assert.match(
    html,
    /html\.is-fullscreen \.presenter-shell\.is-chrome-active \.presenter-topbar,\s*html\.is-fullscreen \.presenter-shell\.is-chrome-active \.presenter-progress \{[^}]*opacity: 1;/,
  );
});

test('a screen-filling window counts as fullscreen (the green button)', async (t) => {
  const { window, root, shell } = await publishedPage(t);
  assert.equal(root.classList.contains('is-fullscreen'), false);
  assert.equal(
    shell.classList.contains('is-chrome-active'),
    true,
    'windowed: bars shown',
  );

  resize(window, SCREEN);
  assert.equal(root.classList.contains('is-fullscreen'), true);
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(
    shell.classList.contains('is-chrome-active'),
    false,
    'entering hides the bars',
  );

  resize(window, { width: 1280, height: 720 });
  assert.equal(root.classList.contains('is-fullscreen'), false);
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(
    shell.classList.contains('is-chrome-active'),
    true,
    'leaving shows them again',
  );
});

test('the Fullscreen API counts as fullscreen (the F key)', async (t) => {
  const { window, document, root, shell } = await publishedPage(t);
  let requested = null;
  shell.requestFullscreen = function () {
    requested = this;
    Object.defineProperty(document, 'fullscreenElement', {
      value: this,
      configurable: true,
    });
    document.dispatchEvent(new window.Event('fullscreenchange'));
    return Promise.resolve();
  };
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f' }));
  assert.equal(requested, shell, 'F fullscreens the shell, like the presenter');
  assert.equal(root.classList.contains('is-fullscreen'), true);
});

test('pointer and focus reveal both bars; navigation keys do not', async (t) => {
  const { window, document, flush, shell } = await publishedPage(t);
  resize(window, SCREEN);
  await flush();
  const active = () => shell.classList.contains('is-chrome-active');
  assert.equal(active(), false);

  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'ArrowRight' }),
  );
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ' }));
  assert.equal(active(), false, 'a clicker does not flash the bars');
  assert.equal(
    document
      .querySelectorAll('section.deck-slide')[1]
      .classList.contains('is-active'),
    true,
    'but it did navigate',
  );

  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(active(), true, 'pointer activity reveals');

  shell.classList.remove('is-chrome-active');
  document.getElementById('btnPrev').focus();
  assert.equal(active(), true, 'Tab into a bar reveals it');
});

test('?ui=min stays out of the fullscreen contract', async (t) => {
  const { window, root, shell, flush } = await publishedPage(t, {
    query: '?ui=min',
  });
  resize(window, SCREEN);
  await flush();
  assert.equal(root.classList.contains('ui-min'), true);
  assert.equal(root.classList.contains('is-fullscreen'), false);
  window.document.dispatchEvent(
    new window.MouseEvent('mousemove', { bubbles: true }),
  );
  assert.equal(shell.classList.contains('is-chrome-active'), false);
});

/** Run a client module against a jsdom document as globals. */
async function withDomGlobals(t, html = '') {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    pretendToBeVisual: true,
  });
  const { window } = dom;
  sizeWindow(window, { width: 1280, height: 720 });
  const saved = {};
  for (const key of ['window', 'document', 'MutationObserver']) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? window : window[key],
      configurable: true,
      writable: true,
    });
  }
  t.after(() => {
    for (const [key, desc] of Object.entries(saved)) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
    window.close();
  });
  return window;
}

test('presenter: attach syncs the class on both signals and detach drops it', async (t) => {
  const window = await withDomGlobals(t);
  const { createPresenterFullscreenController } =
    await import('../client/views/presenter/fullscreen.js');
  const root = window.document.documentElement;
  const ctl = createPresenterFullscreenController({});
  const detach = ctl.attach();
  assert.equal(root.classList.contains('is-fullscreen'), false);
  resize(window, SCREEN);
  assert.equal(root.classList.contains('is-fullscreen'), true);
  detach();
  assert.equal(root.classList.contains('is-fullscreen'), false);
  resize(window, { width: 1280, height: 720 });
  resize(window, SCREEN);
  assert.equal(
    root.classList.contains('is-fullscreen'),
    false,
    'no listener left',
  );
});

test('presenter: bars hide after idle, but not while the pointer rests on one', async (t) => {
  const window = await withDomGlobals(
    t,
    '<div class="presenter-shell"><header class="presenter-topbar"><button>x</button></header><main class="deck"></main><footer class="presenter-progress"></footer></div>',
  );
  const { createChromeAutoHide } =
    await import('../client/views/presenter/chrome-autohide.js');
  const { document } = window;
  const shell = document.querySelector('.presenter-shell');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const active = () => shell.classList.contains('is-chrome-active');
  const auto = createChromeAutoHide({ shell, idleMs: 20 });

  document.documentElement.classList.add('is-fullscreen');
  await wait(0);
  assert.equal(active(), false);

  document
    .querySelector('.deck')
    .dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(active(), true);
  await wait(50);
  assert.equal(active(), false, 'idle hides');

  document
    .querySelector('.presenter-progress')
    .dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  await wait(50);
  assert.equal(active(), true, 'a bar under the pointer stays up');

  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'ArrowRight' }),
  );
  document
    .querySelector('.deck')
    .dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  await wait(50);
  assert.equal(active(), false, 'pointer left the bar: idle hides again');
  auto.detach();
});

/*
 * In-slide presenter controls (B279). The countdown's Start/Pause/Reset row
 * declares `data-presenter-chrome` and follows the bars' signal: hidden in
 * fullscreen until pointer activity, shown with the bars, revealed by Tab,
 * held while the pointer rests on it. No idle timer of its own; outside
 * fullscreen nothing changes.
 */
const countdownDeck = {
  id: 'cd',
  title: 'Countdown',
  slides: [
    { id: 'c1', type: 'countdown-slide', content: { seconds: 60 } },
    { id: 'c2', type: 'payoff-slide', content: {} },
  ],
};

test('in-slide presenter chrome: the countdown row declares it, the CSS keys on the bars signal', async () => {
  const html = await buildStandaloneHtml(repoRoot, countdownDeck, {
    context: 'published',
  });
  assert.match(
    html,
    /<div class="cd-controls" data-countdown-controls="1" data-presenter-chrome hidden>/,
  );
  assert.match(
    html,
    /html\.is-fullscreen \.presenter-shell \[data-presenter-chrome\] \{[^}]*opacity: 0;[^}]*pointer-events: none;/,
    'hidden in fullscreen by opacity, so Tab still reaches it',
  );
  assert.match(
    html,
    /html\.is-fullscreen \.presenter-shell\.is-chrome-active \[data-presenter-chrome\] \{[^}]*opacity: 1;[^}]*pointer-events: auto;/,
    'shown with the bars',
  );
  assert.doesNotMatch(
    html,
    /\[data-presenter-chrome\][^{]*\{[^}]*visibility: hidden/,
    'never visibility: hidden (it would drop the buttons from the tab order)',
  );
  assert.match(
    html,
    /\.slide-countdown \.cd-btn \{[^}]*font-size: var\(--slide-font-size-body\);/,
    'the buttons are sized on the slide type scale, not the 13px app button',
  );
});

test('in-slide presenter chrome on /p/: focus reveals the bars, a resting pointer holds them', async (t) => {
  const html = await buildStandaloneHtml(repoRoot, countdownDeck, {
    context: 'published',
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/p/abcd1234-countdown',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: (window) => sizeWindow(window, { width: 1280, height: 720 }),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const flush = () => new Promise((r) => window.setTimeout(r, 0));
  await flush();
  const shell = document.querySelector('.presenter-shell');
  const controls = document.querySelector('[data-presenter-chrome]');
  const active = () => shell.classList.contains('is-chrome-active');
  assert.ok(controls, 'the countdown row is on the page');
  assert.equal(controls.hidden, false, 'interactive: the row is rendered');

  resize(window, SCREEN);
  await flush();
  assert.equal(active(), false, 'entering fullscreen hides bars and row');

  controls.querySelector('[data-countdown-action="reset"]').focus();
  assert.equal(active(), true, 'Tab into the row reveals it with the bars');

  shell.classList.remove('is-chrome-active');
  controls.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(active(), true, 'pointer activity on the row reveals');
});

test('presenter: a pointer resting on in-slide chrome holds it up', async (t) => {
  const window = await withDomGlobals(
    t,
    '<div class="presenter-shell"><header class="presenter-topbar"></header><main class="deck"><div class="cd-controls" data-presenter-chrome><button>Reset</button></div></main><footer class="presenter-progress"></footer></div>',
  );
  const { createChromeAutoHide } =
    await import('../client/views/presenter/chrome-autohide.js');
  const { document } = window;
  const shell = document.querySelector('.presenter-shell');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const active = () => shell.classList.contains('is-chrome-active');
  const auto = createChromeAutoHide({ shell, idleMs: 20 });

  document.documentElement.classList.add('is-fullscreen');
  await wait(0);
  assert.equal(active(), false);

  document
    .querySelector('[data-presenter-chrome] button')
    .dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  await wait(50);
  assert.equal(active(), true, 'the row under the pointer stays up');

  document
    .querySelector('.deck')
    .dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  await wait(50);
  assert.equal(active(), false, 'pointer left the row: idle hides it again');
  auto.detach();
});
