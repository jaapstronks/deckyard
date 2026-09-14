/**
 * Countdown slides tick in the published deck, the download and the embed.
 *
 * The published page `/p/:id-:slug` is the standalone export. It carried slide
 * navigation, video and stage scaling, but no countdown runtime: a timer slide
 * showed its start time and never moved, auto-start or not, with its controls
 * left hidden.
 *
 * Four rules:
 *   1. **One source.** The stage documents inline the module the app runs,
 *      `client/lib/slide-runtime/countdown-runtime.js`; no render path keeps a
 *      server-side copy of it.
 *   2. **Stage documents only.** The standalone export and the embed show one
 *      slide at a time and get the runtime when the deck has a countdown. The
 *      static sheets (print, PDF, PNG, previews) never do, and asking the chain
 *      for it on a `none` document throws.
 *   3. **Nothing to tick, nothing shipped.** A deck without a countdown
 *      carries none of it.
 *   4. **Auto-start on arrival.** In the published page, an auto-start
 *      countdown runs once its slide is the active one, and not before.
 *
 * Run with: node --test tests/countdown-stage-documents.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import {
  buildScriptChain,
  detectSlideRuntimeNeeds,
} from '../server/utils/script-chain.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import { initSanitizer } from '../shared/sanitize.js';
import { RENDER_PATHS } from '../server/render-paths.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

await initSanitizer();
after(closePuppeteerBrowser);

const STAGE_PATHS = new Set(['export/html', 'utils/embed-html']);

const countdown = (id, title) => ({
  id,
  type: 'countdown-slide',
  content: {
    title,
    autoStart: 'on',
    soundOnZero: 'off',
    durationMinutes: 9,
    durationSeconds: 0,
  },
});

const COUNTDOWN_DECK = {
  id: 'cd',
  title: 'Rondes',
  theme: 'default',
  slides: [
    { id: 's1', type: 'title-slide', content: { title: 'Start' } },
    countdown('s2', 'Ronde 1'),
    countdown('s3', 'Ronde 2'),
  ],
};

const PLAIN_DECK = {
  id: 'plain',
  title: 'Plain',
  theme: 'default',
  slides: [{ id: 's1', type: 'title-slide', content: { title: 'Kop' } }],
};

test('the stage chain inlines the countdown runtime and still parses', () => {
  for (const module of [false, true]) {
    const html = buildScriptChain({
      runtime: 'stage',
      module,
      slideNeeds: { countdown: true },
      body: 'const bodyMarker = 1;',
    });
    assert.match(html, /function initCountdownSlides/);
    assert.match(html, /initCountdownSlides\(document\);/);
    assert.doesNotMatch(html, /^\s*export\s/m);
    const source = html
      .replace(/^<script[^>]*>/, '')
      .replace(/<\/script>$/, '');
    // The chain carries no import or export, so a module body parses as a
    // script too.
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: `stage+countdown` }),
      `module=${module} does not parse`,
    );
  }
});

test('a static document cannot ask for the countdown runtime', () => {
  assert.throws(
    () => buildScriptChain({ slideNeeds: { countdown: true } }),
    /slide runtimes need the stage runtime/,
  );
});

test('detection reads the rendered markup', () => {
  assert.deepEqual(
    detectSlideRuntimeNeeds('<div class="slide slide-countdown">'),
    {
      countdown: true,
    },
  );
  assert.deepEqual(detectSlideRuntimeNeeds('<div class="slide">'), {
    countdown: false,
  });
});

test('only stage documents with a countdown carry the runtime', async (t) => {
  for (const p of RENDER_PATHS) {
    await t.test(p.name, async () => {
      const withCd = await p.build(repoRoot, COUNTDOWN_DECK, {});
      const plain = await p.build(repoRoot, PLAIN_DECK, {});
      assert.doesNotMatch(plain, /initCountdownSlides/);
      if (STAGE_PATHS.has(p.name)) {
        assert.match(withCd, /initCountdownSlides\(document\);/);
      } else {
        assert.doesNotMatch(withCd, /initCountdownSlides/);
      }
    });
  }
});

test('no render path keeps a copy of the countdown runtime', async () => {
  for (const module of new Set(RENDER_PATHS.map((p) => p.module))) {
    const src = await readFile(path.join(repoRoot, module), 'utf8');
    assert.ok(
      !src.includes('data-countdown-display'),
      `${module} reaches into countdown markup itself — the runtime lives in ` +
        'client/lib/slide-runtime/countdown-runtime.js',
    );
  }
});

test('published page: auto-start waits for its slide, then runs', async (t) => {
  const html = await RENDER_PATHS.find((p) => p.name === 'export/html').build(
    repoRoot,
    COUNTDOWN_DECK,
    { context: 'published' },
  );
  const dom = new JSDOM(html, {
    url: 'http://localhost/p/abcd1234-rondes',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const flush = () => new Promise((r) => dom.window.setTimeout(r, 0));
  const sections = [...document.querySelectorAll('section.deck-slide')];
  const running = (i) =>
    sections[i].querySelector('[data-countdown-action="start"]').hidden ===
    true;
  const key = () =>
    document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );

  await flush();
  assert.equal(sections[0].classList.contains('is-active'), true);
  assert.equal(
    sections[1].querySelector('[data-countdown-controls="1"]').hidden,
    false,
    'the controls are shown once the runtime has run',
  );
  assert.equal(running(1), false, 'slide 2 waits while slide 1 is shown');

  key();
  await flush();
  assert.equal(running(1), true, 'slide 2 runs on arrival');
  assert.equal(running(2), false, 'slide 3 still waits');

  key();
  await flush();
  assert.equal(running(2), true, 'slide 3 runs on arrival');
});
