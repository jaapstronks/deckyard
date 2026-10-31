/**
 * The three chrome shapes of the standalone export (B268, D102):
 *
 *   - `default` — the export's topbar and control row (now with a Fullscreen
 *     button);
 *   - `min` — no chrome (pinned in detail by export-ui-min.test.js);
 *   - `strip` — the stage on top, edge to edge, and one toolbar of
 *     `--controls-strip-height` below it with Previous, Next, the counter and
 *     Fullscreen as icon buttons. Loop controls only when the deck loops.
 *
 * In fullscreen the strip is an overlay that shows on pointer activity (D111),
 * using the same client modules as the in-app presenter.
 *
 * Run with: node --test tests/ui-strip.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { buildStandaloneHtml } from '../server/export/html.js';
import {
  CONTROLS_STRIP_HEIGHT,
  controlsStripIcon,
} from '../server/utils/controls-strip.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const deck = {
  id: 'd',
  title: 'Strip',
  slides: [
    { id: 's1', type: 'payoff-slide', content: {} },
    { id: 's2', type: 'payoff-slide', content: {} },
  ],
};

const SCREEN = { width: 1920, height: 1080 };

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

function sizeWindow(window) {
  Object.defineProperty(window.screen, 'width', { value: SCREEN.width });
  Object.defineProperty(window.screen, 'height', { value: SCREEN.height });
  resize(window, { width: 1280, height: 720 }, { dispatch: false });
}

async function run(t, html, url) {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: sizeWindow,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const flush = () => new Promise((r) => window.setTimeout(r, 0));
  await flush();
  return { window, document: window.document, flush };
}

async function exportPage(t, query = '', pres = deck) {
  const html = await buildStandaloneHtml(repoRoot, pres, {
    context: 'published',
  });
  return run(t, html, `http://localhost/p/abcd1234-strip${query}`);
}

test('the export strip height is declared on :root', async () => {
  assert.equal(CONTROLS_STRIP_HEIGHT, '48px');
  const rule = /:root \{\s*--controls-strip-height: 48px;\s*\}/;
  const exportHtml = await buildStandaloneHtml(repoRoot, deck, {});
  assert.match(exportHtml, rule);
  assert.throws(() => controlsStripIcon('loop'), /unknown strip icon "loop"/);
});

// ── Export ────────────────────────────────────────────────────────────────

test('export default: the control row gains a Fullscreen button', async (t) => {
  const { window, document } = await exportPage(t);
  const root = document.documentElement;
  assert.equal(window.__DECK_UI__, 'default');
  assert.equal(root.classList.contains('ui-strip'), false);
  assert.equal(root.classList.contains('ui-min'), false);
  const btnFs = document.getElementById('btnFs');
  assert.ok(btnFs, 'a Fullscreen button in the row');
  assert.equal(btnFs.getAttribute('aria-label'), 'Fullscreen');
  assert.equal(btnFs.closest('.presenter-progress') != null, true);
  // The default row keeps offering the loop controls, as before.
  assert.equal(document.getElementById('btnLoop').hidden, false);

  const shell = document.querySelector('.presenter-shell');
  let requested = null;
  shell.requestFullscreen = function () {
    requested = this;
    return Promise.resolve();
  };
  btnFs.click();
  assert.equal(requested, shell, 'the button runs the presenter toggle');
});

test('export min: unchanged, the strip class stays off', async (t) => {
  const { window, document } = await exportPage(t, '?ui=min');
  assert.equal(window.__DECK_UI__, 'min');
  assert.equal(document.documentElement.classList.contains('ui-min'), true);
  assert.equal(document.documentElement.classList.contains('ui-strip'), false);
});

test('export strip: the class goes on before the shell renders', async (t) => {
  const { window, document } = await exportPage(t, '?ui=STRIP');
  assert.equal(window.__DECK_UI__, 'strip');
  assert.equal(document.documentElement.classList.contains('ui-strip'), true);
  assert.equal(document.documentElement.classList.contains('ui-min'), false);
});

test('export strip CSS: no topbar, one strip row below the stage', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck, {});
  assert.match(
    html,
    /html\.ui-strip \.presenter-shell \{\s*--presenter-topbar-height: 0px;\s*--presenter-progress-height: var\(--controls-strip-height\);/,
  );
  assert.match(html, /html\.ui-strip \.presenter-topbar \{\s*display: none;/);
  assert.match(
    html,
    /html\.ui-strip \.presenter-progress \{[^}]*height: var\(--controls-strip-height\);/,
  );
  // Icons stand in for the labels; the aria-labels stay the names.
  assert.match(
    html,
    /html\.ui-strip \.ps-standalone-btn-label \{\s*display: none;/,
  );
  for (const [id, name] of [
    ['btnPrev', 'Previous slide'],
    ['btnNext', 'Next slide'],
    ['btnFs', 'Fullscreen'],
  ]) {
    assert.match(
      html,
      new RegExp(
        `<button id="${id}"[^>]*aria-label="${name}"><svg class="controls-strip-icon"[^>]*aria-hidden="true"`,
      ),
    );
  }
});

test('export strip in fullscreen: the row collapses, the strip is the overlay', async (t) => {
  const html = await buildStandaloneHtml(repoRoot, deck, {});
  const { window, document, flush } = await exportPage(t, '?ui=strip');
  assert.match(
    html,
    /html\.ui-strip\.is-fullscreen \.presenter-shell \{\s*--presenter-progress-height: 0px;/,
    'the strip row collapses, so the deck fills a true 16:9',
  );
  assert.match(
    html,
    /html\.ui-strip:not\(\.is-fullscreen\) \.presenter-progress \{\s*position: relative;/,
    'windowed only: in fullscreen the presenter overlay positions it',
  );

  const root = document.documentElement;
  const shell = document.querySelector('.presenter-shell');
  const active = () => shell.classList.contains('is-chrome-active');
  resize(window, SCREEN);
  await flush();
  assert.equal(root.classList.contains('is-fullscreen'), true);
  assert.equal(active(), false, 'entering hides the strip');
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(active(), true, 'pointer activity brings it back');
});

test('export strip: loop controls only when the deck loops', async (t) => {
  const still = await exportPage(t, '?ui=strip');
  assert.equal(still.document.getElementById('btnLoop').hidden, true);
  assert.equal(still.document.getElementById('loopIntervalWrap').hidden, true);

  assert.match(
    await buildStandaloneHtml(repoRoot, deck, {}),
    /\.ps-standalone-nav \[hidden\] \{\s*display: none;/,
    'hidden wins over the .btn display',
  );

  const looping = await exportPage(t, '?ui=strip&loop=1');
  assert.equal(looping.document.getElementById('btnLoop').hidden, false);

  const autoDeck = {
    ...deck,
    settings: { autoAdvance: { enabled: true, loop: true } },
  };
  const auto = await exportPage(t, '?ui=strip', autoDeck);
  assert.equal(auto.document.getElementById('btnLoop').hidden, false);
});
