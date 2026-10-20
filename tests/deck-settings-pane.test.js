/**
 * Deck settings pane (B804): the sections, the source-language rule and the
 * address. Guards the section-per-module split (client/views/editor/
 * deck-settings/) — each builder owns its own normalization + DOM + handlers,
 * and createDeckSettingsPane only assembles them — and the route contract in
 * deck-settings/route.js: `/app/:id?panel=settings&section=<key>`, Back and
 * Forward inside the editor, only its own query keys written or removed.
 * With api:null the theme/tags panels take their "unavailable" branch and no
 * network is touched.
 *
 * Run with: node --test tests/deck-settings-pane.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id?lang=nl&slideId=s1',
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
globalThis.Event = dom.window.Event;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;

const {
  createDeckSettingsPane,
  availableDeckSettingsSections,
  resolveDeckSettingsSection,
} = await import('../client/views/editor/deck-settings/index.js');
const { attachDeckSettingsRoute } =
  await import('../client/views/editor/deck-settings/route.js');
const router = await import('../client/lib/state/router.js');
const { setFeatures } = await import('../client/lib/state/features.js');

let renders = 0;
router.setRenderer(() => renders++);
router.startRouter();

function messyPres() {
  return {
    id: 'p1',
    lang: 'zz-bad',
    description: 42, // non-string → normalized to ''
    settings: {
      transitions: { preset: 'garbage' },
      autoAdvance: { intervalSeconds: '17', mode: 'pacing' },
      liveVideo: { enabled: true, streamUrl: 'https://youtu.be/x' },
    },
    slides: [{}, {}, {}],
    tags: ['a', { name: 'b' }],
  };
}

const sectionChildren = (pane, key) =>
  pane.el.querySelector(`section[data-section="${key}"]`).children.length;

/** The next popstate, after the router's own listener has run. */
const nextPop = () =>
  new Promise((resolve) =>
    window.addEventListener('popstate', () => setTimeout(resolve, 0), {
      once: true,
    }),
  );

// ---------------------------------------------------------------- sections

test('the pane assembles every section and normalizes each slice', () => {
  setFeatures({ enableAnalytics: true });
  const pres = messyPres();
  let dirty = 0;
  const pane = createDeckSettingsPane({
    root: document.body,
    pres,
    api: null,
    markDirty: () => dirty++,
    requestSave: () => {},
  });
  assert.equal(pane.el.querySelector('section'), null, 'empty until opened');

  assert.equal(pane.showSection('playback'), 'playback');
  assert.deepEqual(
    [...pane.el.querySelectorAll('.deck-settings-nav-btn')].map(
      (b) => b.dataset.section,
    ),
    [
      'general',
      'appearance',
      'playback',
      'publishing',
      'analytics',
      'live-video',
    ],
  );
  assert.equal(sectionChildren(pane, 'general'), 3, 'language, tags, text');
  assert.equal(sectionChildren(pane, 'appearance'), 1, 'theme');
  assert.equal(sectionChildren(pane, 'playback'), 4, 'builds … timing');
  assert.equal(sectionChildren(pane, 'publishing'), 3, 'Q&A, preview, feed');
  assert.equal(sectionChildren(pane, 'analytics'), 1);
  assert.equal(sectionChildren(pane, 'live-video'), 1);

  const visible = [...pane.el.querySelectorAll('section')].filter(
    (s) => !s.hidden,
  );
  assert.deepEqual(
    visible.map((s) => s.dataset.section),
    ['playback'],
    'one section on screen',
  );
  assert.equal(
    pane.el.querySelector('[aria-current="true"]').getAttribute('data-section'),
    'playback',
  );

  assert.equal(pres.settings.transitions.preset, 'none', 'invalid → none');
  assert.equal(pres.settings.autoAdvance.intervalSeconds, 17, 'coerced');
  assert.equal(pres.description, '', 'non-string description → empty');

  const cb = pane.el.querySelector(
    'section[data-section="playback"] input[type="checkbox"]',
  );
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(dirty, 1, 'a change marks the deck dirty');

  // Closing drops the DOM and its handlers; a reopen builds one set again.
  pane.close();
  assert.equal(pane.el.querySelector('section'), null);
  pane.showSection('playback');
  const again = pane.el.querySelector(
    'section[data-section="playback"] input[type="checkbox"]',
  );
  again.checked = !again.checked;
  again.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(dirty, 2, 'one handler per opening, not one per opening ever');
  pane.close();
  setFeatures(null);
});

test('without the analytics cluster its section is absent and redirects (D260)', () => {
  setFeatures({ enableAnalytics: false });
  assert.ok(!availableDeckSettingsSections().includes('analytics'));
  assert.equal(resolveDeckSettingsSection('analytics'), 'general');
  assert.equal(resolveDeckSettingsSection('bogus'), 'general');
  assert.equal(resolveDeckSettingsSection(null), 'general');
  const pres = messyPres();
  const pane = createDeckSettingsPane({ root: document.body, pres, api: null });
  assert.equal(pane.showSection('analytics'), 'general');
  assert.equal(pane.el.querySelector('[data-section="analytics"]'), null);
  assert.equal(pres.settings.analyticsOptions, undefined, 'stored as it was');
  pane.close();
  setFeatures(null);
});

test('theme and tags show their unavailable branch without an api', () => {
  const pane = createDeckSettingsPane({
    root: document.body,
    pres: messyPres(),
    api: null,
  });
  pane.showSection('general');
  assert.match(pane.el.textContent, /Tags are not available/);
  pane.showSection('appearance');
  assert.match(pane.el.textContent, /Theme selection is not available/);
  pane.close();
});

// ---------------------------------------------------------- source language

test('the source language is read, never written, and links to translations', () => {
  const pres = {
    ...messyPres(),
    lang: 'nl',
    i18n: { versions: { nl: { slides: [] }, 'en-GB': { slides: [] } } },
  };
  const before = JSON.stringify({ lang: pres.lang, i18n: pres.i18n });
  let opened = 0;
  const pane = createDeckSettingsPane({
    root: document.body,
    pres,
    api: null,
    getOpenTranslateView: () => () => opened++,
  });
  pane.showSection('general');
  assert.equal(
    pane.el.querySelector('.deck-settings-lang select'),
    null,
    'no language select',
  );
  assert.match(
    pane.el.querySelector('.deck-settings-lang-source').textContent,
    /\(nl\)/,
  );
  assert.match(
    pane.el.querySelector('.deck-settings-lang-versions').textContent,
    /en-GB/,
  );
  pane.el.querySelector('.deck-settings-lang-translate').click();
  assert.equal(opened, 1, 'the button opens the translation view');
  assert.equal(
    JSON.stringify({ lang: pres.lang, i18n: pres.i18n }),
    before,
    'opening and reading changed nothing',
  );
  pane.close();

  const odd = messyPres();
  const lone = createDeckSettingsPane({ root: document.body, pres: odd });
  lone.showSection('general');
  assert.equal(odd.lang, 'zz-bad', 'an unknown stored language is kept');
  assert.equal(lone.el.querySelector('.deck-settings-lang-translate'), null);
  assert.match(lone.el.textContent, /language menu in the top bar/);
  lone.close();
});

// ------------------------------------------------------------------- route

function attachRoute() {
  const log = [];
  let section = null;
  const route = attachDeckSettingsRoute({
    show: (key) => {
      section = resolveDeckSettingsSection(key);
      log.push(`show:${section}`);
      return section;
    },
    hide: () => {
      section = null;
      log.push('hide');
    },
  });
  return { route, log, shown: () => section };
}

const query = () => Object.fromEntries(new URL(location.href).searchParams);

test('open pushes the address, select replaces it, Back and Forward step inside the editor', async () => {
  history.replaceState(null, '', '/app/test-id?lang=nl&slideId=s1');
  const { route, log, shown } = attachRoute();
  const renderBefore = renders;
  const depth = history.length;

  route.open();
  assert.deepEqual(query(), {
    lang: 'nl',
    slideId: 's1',
    panel: 'settings',
    section: 'general',
  });
  assert.equal(history.length, depth + 1, 'opening is a history entry');

  route.select('playback');
  assert.equal(query().section, 'playback');
  assert.equal(history.length, depth + 1, 'a section switch replaces');

  // The editor moved to another slide while the pane was open.
  router.setQueryParams({ slideId: 's2' });

  let pop = nextPop();
  history.back();
  await pop;
  assert.equal(shown(), null, 'Back closed the pane');
  assert.deepEqual(
    query(),
    { lang: 'nl', slideId: 's2' },
    'only panel/section left; the selected slide stayed',
  );

  pop = nextPop();
  history.forward();
  await pop;
  assert.equal(shown(), 'playback', 'Forward reopened the same section');
  assert.equal(query().slideId, 's2');

  assert.equal(renders, renderBefore, 'no step re-rendered the editor');
  assert.deepEqual(log, [
    'show:general',
    'show:playback',
    'hide',
    'show:playback',
  ]);
  route.detach();
});

test('close steps back over its own entry, and removes only its keys otherwise', async () => {
  history.replaceState(null, '', '/app/test-id?lang=nl&slideId=s1');
  let { route, shown } = attachRoute();
  route.open('publishing');
  const pop = nextPop();
  route.close();
  assert.equal(shown(), null);
  await pop;
  assert.deepEqual(query(), { lang: 'nl', slideId: 's1' });
  route.detach();

  // Opened from the address (reload, link): there is no own entry to undo.
  history.replaceState(
    null,
    '',
    '/app/test-id?lang=nl&panel=settings&section=appearance&x=1',
  );
  ({ route, shown } = attachRoute());
  assert.equal(shown(), 'appearance', 'the address opened the pane');
  const depth = history.length;
  route.close();
  assert.deepEqual(query(), { lang: 'nl', x: '1' });
  assert.equal(history.length, depth, 'closed in place');
  route.detach();
});

test('an unknown or unavailable section is corrected in place', () => {
  setFeatures({ enableAnalytics: false });
  for (const section of ['bogus', 'analytics']) {
    history.replaceState(
      null,
      '',
      `/app/test-id?panel=settings&section=${section}`,
    );
    const depth = history.length;
    const { route, shown } = attachRoute();
    assert.equal(shown(), 'general');
    assert.equal(query().section, 'general');
    assert.equal(history.length, depth, 'no entry for a correction');
    route.detach();
  }
  setFeatures(null);
});

test("after detach the keys are the router's again", async () => {
  history.replaceState(null, '', '/app/test-id?lang=nl');
  const { route } = attachRoute();
  route.open();
  route.detach();
  const before = renders;
  const pop = nextPop();
  history.back();
  await pop;
  assert.equal(renders, before + 1, 'an unclaimed query step re-routes');
});
