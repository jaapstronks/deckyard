/**
 * The editor holds `i18n.active` canonical from the moment it opens a deck
 * (B484).
 *
 * The write seams refuse a language-version key that is not the canonical
 * spelling on the deck axis (B481-B483): `en` is an alias of `en-GB`, not a
 * version of its own. `initPresentationI18n` used to let an alias `active`
 * stand because `normalizeLang('en')` is truthy, and only the first save
 * canonicalized it. Until then the save-to-library modal keyed the slide's
 * version by that alias and the library answered 400.
 *
 * The fix sits at the source: the bootstrap is the one place that makes
 * `active` (and `dominant`) canonical, and every later reader — the save, the
 * library modal — takes it as it stands.
 *
 * Run with: node --test tests/editor-active-lang-canonical.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/p1',
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
globalThis.getComputedStyle = dom.window.getComputedStyle;
// The modal helpers focus-trap on open, which schedules through rAF.
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);

const { initPresentationI18n } =
  await import('../client/views/editor/bootstrap.js');
const { openSaveToLibraryModal } =
  await import('../client/views/editor/modals/save-to-library-modal.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A deck stored before the axis was canonical: `active` spelled `en`. */
function makeAliasDeck(slide) {
  return {
    id: 'p1',
    title: 'Deck',
    revision: 1,
    theme: '',
    slides: [slide],
    i18n: { active: 'en', dominant: 'en', versions: {} },
  };
}

test('the bootstrap canonicalizes an alias active and dominant', () => {
  const pres = makeAliasDeck({ id: 'a', type: 'title-slide', content: {} });
  initPresentationI18n({ pres, initialLang: null });

  assert.equal(pres.i18n.active, 'en-GB');
  assert.equal(pres.i18n.dominant, 'en-GB');
  assert.deepEqual(
    Object.keys(pres.i18n.versions),
    ['en-GB'],
    'the buffers are keyed canonically, and no alias version is created',
  );
});

test('an alias active beats initialLang, as a canonical one does', () => {
  // Canonicalizing is a rename, not a re-pick: the deck's own `active` still
  // wins over the URL's `?lang=`, exactly as it did for a canonical spelling.
  const pres = makeAliasDeck({ id: 'a', type: 'title-slide', content: {} });
  initPresentationI18n({ pres, initialLang: 'nl' });

  assert.equal(pres.i18n.active, 'en-GB');
});

test('the library modal fallback keys the slide by the canonical language', async () => {
  // No text on the slide, so no version counts as "available" and the modal
  // takes its fallback branch: the slide's own content under the active
  // language. That branch is the one that sent `versions.en`.
  const slide = { id: 'a', type: 'image', content: { src: 'x.png' } };
  const pres = makeAliasDeck(slide);
  initPresentationI18n({ pres, initialLang: null });

  const posts = [];
  const api = async (path, opts) => {
    if (opts?.method === 'POST') posts.push({ path, body: opts.body });
    return { id: 'lib1' };
  };

  const root = document.createElement('div');
  document.body.append(root);
  openSaveToLibraryModal({ root, slide, pres, api, suggestedName: 'Beeld' });
  await tick();

  const saveBtn = [...document.querySelectorAll('.modal-actions .btn-primary')]
    .filter((b) => b.textContent === 'Save to library')
    .pop();
  assert.ok(saveBtn, 'the modal renders its save button');
  saveBtn.click();
  await tick();
  await tick();

  assert.equal(posts.length, 1);
  const { i18n } = posts[0].body;
  assert.equal(i18n.dominant, 'en-GB');
  assert.deepEqual(Object.keys(i18n.versions), ['en-GB']);
  assert.deepEqual(i18n.versions['en-GB'].content, { src: 'x.png' });
});
