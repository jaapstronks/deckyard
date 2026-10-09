/**
 * The three chrome shapes of the export and the hosted embed (B268, D102):
 *
 *   - `default` — the export's topbar and control row (now with a Fullscreen
 *     button), the embed's toolbar above the stage;
 *   - `min` — no chrome (pinned in detail by export-ui-min.test.js);
 *   - `strip` — the stage on top, edge to edge, and one toolbar of
 *     `--controls-strip-height` below it with Previous, Next, the counter and
 *     Fullscreen as icon buttons. Loop controls only when the deck loops.
 *
 * In fullscreen the strip is an overlay that shows on pointer activity (D111),
 * and the embed gets that from the same client modules as the export — no
 * fullscreen toggle of its own.
 *
 * Run with: node --test tests/ui-strip.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { buildStandaloneHtml } from '../server/export/html.js';
import {
  buildEmbedHtml,
  parseEmbedOptionsFromUrl,
} from '../server/utils/embed-html/index.js';
import {
  EMBED_UI_MODES,
  parseUiParam,
} from '../server/utils/embed-html/helpers.js';
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

/** jsdom runs no module scripts; the embed body has no top-level await. */
async function embedPage(t, ui) {
  const html = buildEmbedHtml(repoRoot, deck, { publishId: 'p1', ui });
  return run(
    t,
    html.replace('<script type="module">', '<script>'),
    'http://localhost/embed/p1',
  );
}

test('one strip height, on :root, for both shells', async () => {
  assert.equal(CONTROLS_STRIP_HEIGHT, '48px');
  const rule = /:root \{\s*--controls-strip-height: 48px;\s*\}/;
  const exportHtml = await buildStandaloneHtml(repoRoot, deck, {});
  assert.match(exportHtml, rule);
  assert.match(buildEmbedHtml(repoRoot, deck, {}), rule);
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

// ── Hosted embed ──────────────────────────────────────────────────────────

test('embed: the ui vocabulary is default, min and strip', () => {
  assert.deepEqual(EMBED_UI_MODES, ['default', 'min', 'strip']);
  assert.equal(parseUiParam('strip'), 'strip');
  assert.equal(parseUiParam(' Strip '), 'strip');
  assert.equal(parseUiParam('wide'), 'default');
  const opts = parseEmbedOptionsFromUrl(new URL('http://x/e?ui=strip'));
  assert.equal(opts.ui, 'strip');
});

for (const ui of EMBED_UI_MODES) {
  test(`embed ${ui}: the shell and the boot payload carry the mode`, async (t) => {
    const html = buildEmbedHtml(repoRoot, deck, { ui });
    assert.match(html, new RegExp(`<div class="ps-embed ui-${ui}">`));
    const boot = JSON.parse(
      html.match(
        /<script id="boot" type="application\/json">(.*?)<\/script>/,
      )[1],
    );
    assert.equal(boot.options.ui, ui);

    const { document } = await embedPage(t, ui);
    const root = document.querySelector('.ps-embed');
    for (const m of EMBED_UI_MODES) {
      assert.equal(root.classList.contains(`ui-${m}`), m === ui, `ui-${m}`);
    }
  });
}

test('embed strip CSS: the toolbar moves below the stage at the strip height', () => {
  const html = buildEmbedHtml(repoRoot, deck, { ui: 'strip' });
  assert.match(
    html,
    /\.ps-embed\.ui-strip \.ps-embed-deck-wrap \{\s*order: 1;/,
  );
  assert.match(
    html,
    /\.ps-embed\.ui-strip \.ps-embed-controls \{\s*order: 2;[^}]*height: var\(--controls-strip-height\);/,
  );
  // Same buttons, same ids, icon content with the aria-label as the name.
  for (const [id, name] of [
    ['btnPrev', 'Previous slide'],
    ['btnNext', 'Next slide'],
    ['btnFs', 'Fullscreen'],
  ]) {
    assert.match(
      html,
      new RegExp(
        `<button id="${id}"[^>]*aria-label="${name}"><svg class="controls-strip-icon"`,
      ),
    );
  }
  assert.match(html, /id="progress" class="ps-embed-progress"/);
});

test('embed: SET_OPTIONS switches to the strip and back', async (t) => {
  const { window, document } = await embedPage(t, 'default');
  const root = document.querySelector('.ps-embed');
  const send = (payload) =>
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          source: 'presentation-system-embed',
          type: 'SET_OPTIONS',
          payload,
        },
        source: window.parent,
      }),
    );
  send({ ui: 'strip' });
  assert.equal(root.classList.contains('ui-strip'), true);
  assert.equal(root.classList.contains('ui-default'), false);
  send({ ui: 'min' });
  assert.equal(root.classList.contains('ui-min'), true);
  assert.equal(root.classList.contains('ui-strip'), false);
});

test('embed fullscreen: the presenter modules, not a toggle of its own', () => {
  const html = buildEmbedHtml(repoRoot, deck, { ui: 'strip' });
  assert.match(
    html,
    /const createPresenterFullscreenController = \(\(\) => \{/,
  );
  assert.match(html, /const createChromeAutoHide = \(\(\) => \{/);
  assert.doesNotMatch(
    html,
    /document\.documentElement;\s*if \(!document\.fullscreenElement\)/,
    'the old private toggle on <html> is gone',
  );
  assert.doesNotMatch(html, /[\w\])]:fullscreen\b/, 'no :fullscreen spelling');
  assert.match(
    html,
    /html\.is-fullscreen \.ps-embed\.ui-strip \.ps-embed-controls \{[^}]*bottom: 0;/,
    'the strip returns from the bottom edge',
  );
  assert.match(
    html,
    /html\.is-fullscreen \.ps-embed\.is-chrome-active \.ps-embed-controls \{[^}]*opacity: 1;/,
  );
});

test('embed fullscreen: the button fullscreens the shell, the strip hides and returns', async (t) => {
  const { window, document, flush } = await embedPage(t, 'strip');
  const root = document.querySelector('.ps-embed');
  const html = document.documentElement;
  let requested = null;
  root.requestFullscreen = function () {
    requested = this;
    Object.defineProperty(document, 'fullscreenElement', {
      value: this,
      configurable: true,
    });
    document.dispatchEvent(new window.Event('fullscreenchange'));
    return Promise.resolve();
  };
  document.getElementById('btnFs').click();
  assert.equal(requested, root, 'the embed shell is what goes fullscreen');
  assert.equal(html.classList.contains('is-fullscreen'), true);
  await flush();
  const active = () => root.classList.contains('is-chrome-active');
  assert.equal(active(), false, 'entering hides the strip');

  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  );
  assert.equal(active(), false, 'navigation keys do not flash it');
  assert.equal(
    document.querySelectorAll('.deck-slide')[1].classList.contains('is-active'),
    true,
    'but they did navigate',
  );
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(active(), true, 'pointer activity brings it back');

  root.classList.remove('is-chrome-active');
  document.getElementById('btnPrev').focus();
  assert.equal(active(), true, 'Tab into the strip reveals it');
});

test('embed: allowFullscreen=false still gates the toggle', async (t) => {
  const html = buildEmbedHtml(repoRoot, deck, {
    ui: 'strip',
    allowFullscreen: false,
  });
  const { document, window } = await run(
    t,
    html.replace('<script type="module">', '<script>'),
    'http://localhost/embed/p1',
  );
  const root = document.querySelector('.ps-embed');
  let requested = false;
  root.requestFullscreen = () => {
    requested = true;
    return Promise.resolve();
  };
  assert.equal(document.getElementById('btnFs').style.display, 'none');
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'f', bubbles: true }),
  );
  assert.equal(requested, false);
});

// The host-page SDK sizes the iframe box. Under `ui=strip` the toolbar sits
// below the slide, so the box is the slide's ratio plus the strip (B629).
function sdkWindow({ aspectRatioSupport }) {
  const dom = new JSDOM('<!doctype html><div id="host"></div>', {
    url: 'https://host.example/page',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.CSS = { supports: () => aspectRatioSupport };
  window.eval(
    fs.readFileSync(path.join(repoRoot, 'client/embed-sdk.js'), 'utf8'),
  );
  return window;
}

// JSDOM folds calc(); compare against the same value set on a scratch node.
function css(window, prop, value) {
  const node = window.document.createElement('div');
  node.style[prop] = value;
  return node.style[prop];
}

function sdkEmbed(window, options) {
  return window.PresentationSystemEmbed.createDeckEmbed({
    el: window.document.getElementById('host'),
    publishId: 'pub1',
    options: { baseUrl: 'https://deck.example', ...options },
  });
}

for (const aspectRatioSupport of [true, false]) {
  test(`embed SDK: the strip adds its height to the box (aspect-ratio ${aspectRatioSupport ? 'native' : 'fallback'})`, (t) => {
    const window = sdkWindow({ aspectRatioSupport });
    t.after(() => window.close());

    const plain = sdkEmbed(window, {})._wrapper.style;
    if (aspectRatioSupport) {
      assert.equal(
        plain.aspectRatio,
        css(window, 'aspectRatio', String(16 / 9)),
      );
      assert.equal(plain.paddingTop, '');
    } else {
      assert.equal(
        plain.paddingTop,
        css(window, 'paddingTop', `calc(100% / ${16 / 9})`),
      );
    }

    const strip = sdkEmbed(window, { ui: 'strip', aspectRatio: 4 / 3 })._wrapper
      .style;
    assert.equal(strip.aspectRatio, '');
    assert.equal(
      strip.paddingTop,
      css(
        window,
        'paddingTop',
        `calc(100% / ${4 / 3} + ${CONTROLS_STRIP_HEIGHT})`,
      ),
    );
  });
}

test('embed SDK: setOptions resizes the box for every ui the embed accepts', (t) => {
  const window = sdkWindow({ aspectRatioSupport: true });
  t.after(() => window.close());
  const embed = sdkEmbed(window, {});
  const box = embed._wrapper.style;
  const hasStrip = () => box.paddingTop.includes(CONTROLS_STRIP_HEIGHT);

  for (const ui of EMBED_UI_MODES) {
    embed.setOptions({ ui: 'strip' });
    assert.equal(hasStrip(), true);
    embed.setOptions({ ui });
    assert.equal(hasStrip(), ui === 'strip', `ui=${ui}`);
  }
  // A value the embed ignores leaves the box as it is.
  embed.setOptions({ ui: 'strip' });
  embed.setOptions({ ui: 'sideways' });
  assert.equal(hasStrip(), true);
});
