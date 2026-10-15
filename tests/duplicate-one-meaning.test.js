/**
 * "Duplicate" has one meaning on every editor path (D118): the slide with its
 * nested children. The slide list (context menu + Cmd+D) and the form header's
 * ⋯ menu used to share one label while the ⋯ menu copied the parent alone, so
 * a parent duplicated from the header lost its structure without a word.
 *
 * The ⋯ above the canvas is gone now (B703 PR 3) and Duplicate has one home,
 * the slide-list menu (right-click and the thumbnail's ⋯), which runs
 * duplicateSlides(). This file drives the routine and the menu on the same
 * nested deck, and pins that the type pill's menu grew no copy of its own.
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
// The menu positions itself on the next frame; nothing here measures it.
globalThis.requestAnimationFrame = () => 0;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { duplicateSlides } =
  await import('../client/views/editor/slide-list/slide-actions.js');
const { showSlideContextMenu, closeSlideContextMenu } =
  await import('../client/views/editor/slide-list/context-menu.js');

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

test('slide-list menu: the parent is duplicated with its child', () => {
  const pres = nestedDeck();
  const stub = editorStub();
  showSlideContextMenu({
    x: 0,
    y: 0,
    slide: pres.slides[0],
    ids: new Set(['p']),
    ctx: {
      pres,
      slideTypes: SLIDE_TYPES,
      editorState: stub.editorState,
      setSelectedSlideId: stub.setSelectedSlideId,
      markDirty: stub.markDirty,
    },
  });
  const button = [
    ...document.querySelectorAll('.slide-context-menu-item'),
  ].find((b) => b.textContent === 'Duplicate');
  assert.ok(button, 'the slide-list menu offers Duplicate');
  button.click();
  closeSlideContextMenu();
  assertSubtreeDuplicated(pres, stub.calls);
});

test('the type pill menu carries no slide action of its own', () => {
  const src = readFileSync(
    new URL('../client/views/editor/editor-form/type-menu.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /cloneSlidesForInsert/);
  assert.doesNotMatch(src, /duplicateSlides/);
  assert.doesNotMatch(src, /lockedByAuthor/);
});
