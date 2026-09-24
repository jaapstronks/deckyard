/**
 * "Duplicate" has one meaning on every editor path (D118): the slide with its
 * nested children. The slide list (context menu + Cmd+D) and the form header's
 * ⋯ menu used to share one label while the ⋯ menu copied the parent alone, so
 * a parent duplicated from the header lost its structure without a word.
 *
 * Both paths now run duplicateSlides(); this file drives each on the same
 * nested deck and asserts the same result.
 *
 * Run with: node --test tests/duplicate-one-meaning.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { duplicateSlides } =
  await import('../client/views/editor/slide-list/slide-actions.js');
const { buildHeaderActions } =
  await import('../client/views/editor/editor-form/header-actions.js');

function nestedDeck() {
  return {
    id: 'deck-1',
    slides: [
      { id: 'p', type: 'title', parentId: null, content: { title: 'Parent' } },
      { id: 'c', type: 'title', parentId: 'p', content: { title: 'Child' } },
      { id: 'n', type: 'title', parentId: null, content: { title: 'Next' } },
    ],
  };
}

function editorStub() {
  const calls = { selected: null, dirty: 0 };
  return {
    calls,
    setSelectedSlideId: (id) => {
      calls.selected = id;
    },
    markDirty: () => {
      calls.dirty += 1;
    },
    editorState: {
      refreshAll: () => {},
      dirtyRefreshAll: () => {
        calls.dirty += 1;
      },
    },
  };
}

/** The shape both paths must produce: parent + child copied, nested, fresh. */
function assertSubtreeDuplicated(pres, calls) {
  const titles = pres.slides.map((s) => s.content.title);
  assert.deepEqual(titles, ['Parent', 'Child', 'Parent', 'Child', 'Next']);
  const [, , newParent, newChild] = pres.slides;
  assert.ok(!['p', 'c', 'n'].includes(newParent.id), 'parent gets a new id');
  assert.ok(!['p', 'c', 'n'].includes(newChild.id), 'child gets a new id');
  assert.notEqual(newParent.id, newChild.id);
  assert.equal(newParent.parentId, null);
  assert.equal(newChild.parentId, newParent.id, 'child hangs under the copy');
  assert.equal(pres.slides[1].parentId, 'p', 'the original stays nested');
  assert.equal(calls.selected, newParent.id);
  assert.ok(calls.dirty > 0);
}

test('slide list (context menu + Cmd+D): the parent is duplicated with its child', () => {
  const pres = nestedDeck();
  const stub = editorStub();
  duplicateSlides({
    ids: ['p'],
    pres,
    slideTypes: SLIDE_TYPES,
    editorState: stub.editorState,
    setSelectedSlideId: stub.setSelectedSlideId,
    markDirty: stub.markDirty,
  });
  assertSubtreeDuplicated(pres, stub.calls);
});

test('form header ⋯ menu: the parent is duplicated with its child', () => {
  const pres = nestedDeck();
  const stub = editorStub();
  const { el } = buildHeaderActions({
    slide: pres.slides[0],
    pres,
    api: null,
    toast: { success() {}, error() {} },
    SLIDE_TYPES,
    openSlideLibraryModal: () => {},
    setSelectedSlideId: stub.setSelectedSlideId,
    editorState: stub.editorState,
    rerenderEditor: () => {},
    onTranslateSlide: null,
    user: null,
    markDirty: stub.markDirty,
    rerenderPreview: () => {},
    rerenderSlideList: () => {},
    isAuthor: true,
  });
  const button = [...el.querySelectorAll('button.dropdown-item')].find(
    (b) => b.textContent === 'Duplicate',
  );
  assert.ok(button, 'the ⋯ menu offers Duplicate');
  button.click();
  assertSubtreeDuplicated(pres, stub.calls);
});

test('the ⋯ menu carries no copy recipe of its own', () => {
  const src = readFileSync(
    new URL(
      '../client/views/editor/editor-form/header-actions.js',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(src, /cloneSlidesForInsert/);
  assert.match(src, /duplicateSlides\(/);
});
