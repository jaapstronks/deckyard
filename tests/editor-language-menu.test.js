/**
 * The editor topbar's language menu (B182 fase 2, D72 #1).
 *
 * One menu per deck, for every n. What is pinned here is the thing the fixed
 * NL/EN toggle it replaces could not do: a deck with three versions is listed
 * as three versions, each with its own translation status, and the languages
 * the deck has *no* version for are offered separately under "Add language…".
 *
 * The bug this closes: on a deck whose versions are `nl`, `de` and `fr` the old
 * control rendered two buttons — NL and EN — so the German and French versions
 * were viewable in the presenter and unreachable in the editor.
 *
 * Run with: node --test tests/editor-language-menu.test.js
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

const { normalizeLang, setSupportedLangs } =
  await import('../client/lib/format/i18n.js');
const { createLanguageMode } =
  await import('../client/views/editor/topbar/language-mode.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

const titleSlide = (id, title) => ({
  id,
  type: 'title-slide',
  content: { title },
  notes: '',
});

/**
 * A deck in Dutch, German and French. The Dutch version is the source; German
 * is fully translated, French is missing one of the two titles.
 */
function makeTrilingualPres() {
  return {
    id: 'p1',
    title: 'Deck',
    slides: [titleSlide('s1', 'Eén'), titleSlide('s2', 'Twee')],
    theme: null,
    revision: 1,
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: {
          title: 'Deck',
          slides: [titleSlide('s1', 'Eén'), titleSlide('s2', 'Twee')],
        },
        de: {
          title: 'Deck',
          slides: [titleSlide('s1', 'Eins'), titleSlide('s2', 'Zwei')],
        },
        fr: {
          title: 'Deck',
          slides: [titleSlide('s1', 'Un'), titleSlide('s2', '')],
        },
      },
    },
  };
}

function mount({ pres, api = async () => ({}) } = {}) {
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
    toast: { info: () => {}, success: () => {}, error: () => {} },
  });
  document.body.replaceChildren(controller.el);
  return controller;
}

/** `[label, status]` for every row, in menu order, sections separated by `--`. */
function readMenu(controller) {
  const menu = controller.el.querySelector('.dropdown-menu');
  return [...menu.children].map((el) => {
    if (el.classList.contains('dropdown-sep')) return '--';
    if (el.classList.contains('dropdown-help')) return `# ${el.textContent}`;
    return [
      el.querySelector('.lang-menu-name')?.textContent ?? el.textContent,
      el.querySelector('.lang-menu-status')?.textContent ?? '',
    ];
  });
}

test('every version of the deck is listed, with its translation status', () => {
  setSupportedLangs(['nl', 'en-GB', 'de', 'fr']);
  const controller = mount({ pres: makeTrilingualPres() });

  assert.deepEqual(readMenu(controller), [
    ['Nederlands', 'source'],
    ['Deutsch', '✓'],
    // One of the two French titles is empty, and the deck title is not missing.
    ['Français', '1 missing'],
    '--',
    '# Add language…',
    ['English', ''],
  ]);
});

test('the trigger names the version being edited', () => {
  setSupportedLangs(['nl', 'en-GB', 'de', 'fr']);
  const pres = makeTrilingualPres();
  pres.i18n.active = 'fr';
  const controller = mount({ pres });

  assert.equal(
    controller.el.querySelector('.lang-menu-label').textContent,
    'Français',
  );
  const active = controller.el.querySelector('.lang-menu-item.is-active');
  assert.equal(active.querySelector('.lang-menu-name').textContent, 'Français');
  assert.equal(active.getAttribute('aria-current'), 'true');
});

test('"Add language…" offers the workspace subset minus the existing versions', () => {
  setSupportedLangs(['nl', 'en-GB', 'de', 'fr', 'es', 'it']);
  const controller = mount({ pres: makeTrilingualPres() });

  const rows = readMenu(controller);
  const sep = rows.indexOf('--');
  const addable = rows
    .slice(sep + 2)
    .map(([label]) => label)
    .sort();
  assert.deepEqual(addable, ['English', 'Español', 'Italiano']);
});

test('choosing an existing version switches the editor into it', async () => {
  setSupportedLangs(['nl', 'en-GB', 'de', 'fr']);
  const pres = makeTrilingualPres();
  const requested = [];
  const controller = mount({
    pres,
    api: async (url) => {
      requested.push(url);
      return {
        title: 'Deck',
        slides: [titleSlide('s1', 'Eins'), titleSlide('s2', 'Zwei')],
        theme: null,
        revision: 2,
        i18n: {
          active: 'de',
          dominant: 'nl',
          versions: structuredClone(pres.i18n.versions),
        },
      };
    },
  });

  const german = [...controller.el.querySelectorAll('.lang-menu-item')].find(
    (b) => b.querySelector('.lang-menu-name')?.textContent === 'Deutsch',
  );
  german.click();
  await flush();

  assert.ok(
    requested.some((u) => u.includes('lang=de')),
    'the German version is fetched',
  );
  assert.equal(pres.i18n.active, 'de');
  assert.equal(
    controller.el.querySelector('.lang-menu-label').textContent,
    'Deutsch',
  );
});

test('a language with no version yet is created on the spot', async () => {
  setSupportedLangs(['nl', 'en-GB', 'de', 'fr']);
  const pres = makeTrilingualPres();
  const controller = mount({
    pres,
    api: async () => ({
      title: 'Deck',
      slides: [],
      theme: null,
      revision: 2,
      i18n: {
        active: 'en-GB',
        dominant: 'nl',
        versions: { ...structuredClone(pres.i18n.versions), 'en-GB': {} },
      },
    }),
  });

  const english = [...controller.el.querySelectorAll('.lang-menu-item')].find(
    (b) => b.textContent.trim() === 'English',
  );
  english.click();
  await flush();

  assert.equal(pres.i18n.active, 'en-GB');
  assert.ok(
    pres.i18n.versions['en-GB'],
    'the version buffer exists after the switch',
  );
  const popover = controller.el.querySelector('.lang-popover');
  assert.ok(
    popover.classList.contains('is-visible'),
    'and the translate invite is offered for the empty version',
  );
  // Dismiss it: the invite holds a 15s auto-hide timer that would otherwise
  // keep the test runner's event loop alive until it fires.
  popover.querySelectorAll('.lang-popover-btn')[1].click();
});

test('adding an empty version leaves the source where it was (D74)', async () => {
  // The regression this pins: the switch used to move `i18n.dominant` onto the
  // language being opened, so a version created empty a moment ago was labelled
  // "source" and every written version was reported as missing all of its text.
  // `dominant` is the language the deck was written in and only an explicit
  // action moves it, so the brand-new version is the one with a count.
  setSupportedLangs(['nl', 'en-GB', 'de', 'fr']);
  const pres = makeTrilingualPres();
  const controller = mount({
    pres,
    api: async () => ({
      title: 'Deck',
      slides: [],
      theme: null,
      revision: 2,
      i18n: {
        active: 'en-GB',
        dominant: 'nl',
        versions: { ...structuredClone(pres.i18n.versions), 'en-GB': {} },
      },
    }),
  });

  const english = [...controller.el.querySelectorAll('.lang-menu-item')].find(
    (b) => b.textContent.trim() === 'English',
  );
  english.click();
  await flush();

  assert.equal(
    pres.i18n.dominant,
    'nl',
    'the source did not follow the switch',
  );
  assert.deepEqual(readMenu(controller), [
    ['Nederlands', 'source'],
    ['Deutsch', '✓'],
    ['Français', '1 missing'],
    // Both slide titles the Dutch original fills are still blank here.
    ['English', '2 missing'],
  ]);

  // Dismiss the translate invite: it holds a 15s auto-hide timer that would
  // otherwise keep the test runner's event loop alive until it fires.
  controller.el
    .querySelector('.lang-popover')
    .querySelectorAll('.lang-popover-btn')[1]
    .click();
});

test('a version the deck has stays switchable when admin disabled its language', async () => {
  // The admin subset gates *adding*; a version that exists is always editable,
  // otherwise the menu lists a language it then refuses (B182 in a new shape).
  setSupportedLangs(['nl', 'en-GB']);
  const pres = makeTrilingualPres();
  const controller = mount({
    pres,
    api: async () => ({
      title: 'Deck',
      slides: [titleSlide('s1', 'Eins'), titleSlide('s2', 'Zwei')],
      theme: null,
      revision: 2,
      i18n: {
        active: 'de',
        dominant: 'nl',
        versions: structuredClone(pres.i18n.versions),
      },
    }),
  });

  const german = [...controller.el.querySelectorAll('.lang-menu-item')].find(
    (b) => b.querySelector('.lang-menu-name')?.textContent === 'Deutsch',
  );
  assert.ok(german, 'the German version is listed');
  german.click();
  await flush();
  assert.equal(pres.i18n.active, 'de');
});

test('a load that does not carry the version fails visibly and leaves the model alone', async () => {
  setSupportedLangs(['nl', 'en-GB', 'de', 'fr']);
  const pres = makeTrilingualPres();
  const errors = [];
  const controller = createLanguageMode({
    root: document.body,
    pres,
    id: 'p1',
    // A projection without the requested version (a buffer that has not
    // reached the live doc yet).
    api: async () => ({
      title: 'Deck',
      slides: pres.slides,
      theme: null,
      revision: 2,
      i18n: {
        active: 'nl',
        dominant: 'nl',
        versions: { nl: pres.i18n.versions.nl },
      },
    }),
    requestSave: async () => {},
    isDirty: () => false,
    markDirty: () => {},
    normalizeLang,
    getSelectedSlideId: () => null,
    setSelectedSlideId: () => {},
    editorState: { refreshAll: () => {} },
    topbarTitleEl: null,
    toast: {
      info: () => {},
      success: () => {},
      error: (msg) => errors.push(msg),
    },
  });
  document.body.replaceChildren(controller.el);

  const german = [...controller.el.querySelectorAll('.lang-menu-item')].find(
    (b) => b.querySelector('.lang-menu-name')?.textContent === 'Deutsch',
  );
  german.click();
  await flush();

  assert.equal(errors.length, 1, 'one error toast');
  assert.match(errors[0], /Deutsch/);
  assert.equal(pres.i18n.active, 'nl', 'active did not move');
  assert.equal(pres.i18n.dominant, 'nl');
});
