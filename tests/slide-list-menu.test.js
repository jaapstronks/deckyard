/**
 * The slide-list menu is the one home of the slide actions (B703 PR 3, D335):
 * right-click on a row or the ⋯ on its thumbnail opens it, and it carries what
 * the ⋯ above the canvas used to (Duplicate, Delete, Lock, Save to slide
 * library) plus Copy and Paste (B308).
 *
 * Copy and Paste run the same routines as ⌘C/⌘V and the paste bar
 * (`copySlidesToClipboard` over `copySlides`, and `pasteSlidesFromClipboard`),
 * so the buffer also reaches another deck. This file drives the menu on a
 * nested deck and pins the shared seams in the source.
 *
 * Run with: node --test tests/slide-list-menu.test.js
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
const { showSlideContextMenu, closeSlideContextMenu } =
  await import('../client/views/editor/slide-list/context-menu.js');
const { getClipboardCount } =
  await import('../client/lib/slide-authoring/slide-clipboard.js');
const { createSlideItem } =
  await import('../client/views/editor/slide-list/render-item.js');

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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

/** Editor callbacks the menu passes on; `selected` follows the selection. */
function ctxFor(pres, { author = false, api = null } = {}) {
  const state = { selected: null, refreshed: 0 };
  return {
    state,
    ctx: {
      pres,
      slideTypes: SLIDE_TYPES,
      editorState: {
        refreshAll: () => {},
        dirtyRefreshAll: () => {
          state.refreshed += 1;
        },
      },
      getSelectedSlideId: () => state.selected,
      setSelectedSlideId: (id) => {
        state.selected = id;
      },
      markDirty: () => {},
      isAuthor: () => author,
      api,
      openSlideLibraryModal: () => {},
    },
  };
}

/** Open the menu on `slideId` and return its items by label. */
function openMenu(pres, slideId, ctx) {
  showSlideContextMenu({
    x: 0,
    y: 0,
    slide: pres.slides.find((s) => s.id === slideId),
    ids: new Set([slideId]),
    ctx,
  });
  return [...document.querySelectorAll('.slide-context-menu-item')];
}

const byLabel = (items, label) => items.find((b) => b.textContent === label);

test('Copy then Paste: the parent and its child land after the selected slide', () => {
  localStorage.clear();
  const pres = nestedDeck();
  const { ctx, state } = ctxFor(pres);

  let items = openMenu(pres, 'p', ctx);
  const paste = byLabel(items, 'Paste');
  assert.ok(paste, 'Paste is offered');
  assert.equal(paste.disabled, true, 'nothing to paste yet');
  byLabel(items, 'Copy').click();
  closeSlideContextMenu();
  assert.equal(getClipboardCount(), 2, 'the child is copied with its parent');

  state.selected = 'n';
  items = openMenu(pres, 'n', ctx);
  const pasteN = byLabel(items, 'Paste 2 slides');
  assert.ok(pasteN && !pasteN.disabled, 'Paste names what it will paste');
  pasteN.click();
  closeSlideContextMenu();

  const titles = pres.slides.map((s) => s.content.title);
  assert.deepEqual(titles, ['Parent', 'Child', 'Next', 'Parent', 'Child']);
  const [, , , newParent, newChild] = pres.slides;
  assert.equal(newChild.parentId, newParent.id, 'nesting survives the paste');
  assert.equal(
    state.selected,
    newParent.id,
    'the first pasted slide is selected',
  );
});

test('Copy and Paste run the same routines as ⌘C/⌘V', () => {
  const menu = read('client/views/editor/slide-list/context-menu.js');
  const keys = read('client/views/editor/slide-list/keyboard-nav.js');
  for (const [name, src] of [
    ['context-menu', menu],
    ['keyboard-nav', keys],
  ]) {
    assert.match(src, /copySlidesToClipboard\(/, `${name} copies via the seam`);
    assert.match(
      src,
      /pasteSlidesFromClipboard\(/,
      `${name} pastes via the seam`,
    );
    assert.doesNotMatch(src, /\bcopySlides\(/, `${name} has no copy recipe`);
  }
  const actions = read('client/views/editor/slide-list/slide-actions.js');
  assert.match(actions, /copySlides\(slidesToCopy\)/);
});

test('Lock: authors only, and it flips to Unlock once the slide is locked', () => {
  const pres = nestedDeck();
  const other = ctxFor(pres, { author: false });
  let items = openMenu(pres, 'p', other.ctx);
  assert.equal(byLabel(items, 'Lock slide'), undefined, 'no lock for others');
  closeSlideContextMenu();

  const { ctx, state } = ctxFor(pres, { author: true });
  items = openMenu(pres, 'p', ctx);
  byLabel(items, 'Lock slide').click();
  closeSlideContextMenu();
  assert.equal(pres.slides[0].lockedByAuthor, true);
  assert.ok(state.refreshed > 0, 'the lock is saved');

  items = openMenu(pres, 'p', ctx);
  byLabel(items, 'Unlock slide').click();
  closeSlideContextMenu();
  assert.equal(pres.slides[0].lockedByAuthor, false);
});

test('Save to slide library: one slide, and only a type with content of its own', () => {
  const pres = {
    id: 'deck-1',
    slides: [
      { id: 'a', type: 'title-slide', content: { title: 'A' } },
      { id: 'f', type: 'follow-invite-slide', content: {} },
    ],
  };
  const label = 'Save to slide library…';
  const noApi = ctxFor(pres);
  assert.equal(byLabel(openMenu(pres, 'a', noApi.ctx), label), undefined);
  closeSlideContextMenu();

  const { ctx } = ctxFor(pres, { api: async () => ({}) });
  assert.equal(byLabel(openMenu(pres, 'a', ctx), label).disabled, false);
  closeSlideContextMenu();
  assert.equal(byLabel(openMenu(pres, 'f', ctx), label).disabled, true);
  closeSlideContextMenu();
});

test('Delete is the last item, Duplicate is there', () => {
  const pres = nestedDeck();
  const items = openMenu(pres, 'n', ctxFor(pres).ctx);
  assert.ok(byLabel(items, 'Duplicate'));
  assert.equal(items.at(-1).textContent, 'Delete');
  assert.ok(items.at(-1).classList.contains('is-danger'));
  closeSlideContextMenu();
});

test('the thumbnail carries a ⋯ that opens the menu, top-left (B497 keeps the bottom edge)', () => {
  const pres = nestedDeck();
  const opened = [];
  const { item } = createSlideItem({
    slide: pres.slides[2],
    match: null,
    context: {
      pres,
      selectedSlideId: null,
      multiSelectedIds: new Set(),
      searchActive: false,
      indexById: new Map([['n', 2]]),
      childrenMap: new Map(),
      collapsedParents: new Set(),
      SLIDE_TYPES,
      renderSlideElement: () => document.createElement('div'),
      openSlideMenu: (button) => opened.push(button),
    },
  });
  const button = item.querySelector('.thumb-mini .slide-item-menu-btn');
  assert.ok(button, 'the ⋯ sits on the thumbnail');
  assert.equal(button.getAttribute('aria-haspopup'), 'menu');
  button.click();
  assert.deepEqual(opened, [button]);

  const css = read('client/styles/app/editor/31-slide-overlays.css');
  const rule = css.match(/\n\.slide-item-menu-btn \{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /\btop:/);
  assert.doesNotMatch(rule, /\bbottom:/);
});

test('the ⋯ above the canvas and the Layout chip are gone', () => {
  const files = [
    'client/views/editor/preview-panel.js',
    'client/views/editor/editor-form/index.js',
    'client/views/editor/editor-form/type-menu.js',
    'client/views/editor/layout-switcher.js',
  ];
  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /slide-actions-btn|layout-switcher-chip/, file);
    assert.doesNotMatch(src, /slideToolbarActions|actionsEl/, file);
  }
  assert.doesNotMatch(
    read('client/views/editor/editor-form/type-menu.js'),
    /deleteSlides|duplicateSlides|saveToLibrary|lockedByAuthor/,
    'the type menu holds no slide action',
  );
});
