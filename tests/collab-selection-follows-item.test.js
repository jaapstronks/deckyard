/**
 * The canvas selection stays on its item when a collaborator moves the list
 * under it (B894).
 *
 * The selection was an index: after a remote move the inspector rebuilt with
 * `selectedElement.idx` unchanged, so "This row" and the canvas highlight
 * jumped to the row that took the place. The editor now holds the selection
 * in an anchor that finds the item again by the collection editor's rule
 * (`locateItem`, DY-781) and clears it when the item is gone.
 *
 * Two editors share one live doc the way two browser tabs do; tab A has a
 * row selected, tab B moves or removes rows in its Fields form.
 *
 * Run with: node --test tests/collab-selection-follows-item.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
  pretendToBeVisual: true,
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
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = dom.window.ResizeObserver || NoopObserver;
globalThis.IntersectionObserver =
  dom.window.IntersectionObserver || NoopObserver;

const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec } = await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } =
  await import('../client/views/editor/live-edits/live-doc-binder.js');
const { createFieldRenderers } =
  await import('../client/views/editor/fields/index.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form/index.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { createElementAnchor } =
  await import('../client/views/editor/editor-form/element-anchor.js');

const codec = createDeckYdocCodec(Y);

function textBlocksSlide() {
  return {
    id: 's1',
    type: 'text-blocks-slide',
    notes: '',
    content: {
      ...structuredClone(SLIDE_TYPES['text-blocks-slide'].defaults),
      rows: [
        {
          title: 'One',
          color: 'yellow',
          arrow: 'down',
          blocks: [{ title: 'A' }],
        },
        {
          title: 'Two',
          color: 'yellow',
          arrow: 'none',
          blocks: [{ title: 'B' }],
        },
      ],
    },
  };
}

function pres() {
  const slides = [textBlocksSlide()];
  return {
    id: 'p1',
    title: 'Deck',
    lang: 'nl',
    theme: 'default',
    visibility: 'private',
    slides,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: { nl: { title: 'Deck', slides } },
    },
  };
}

/**
 * One browser tab: its own doc, pres, binder and rendered form. The selected
 * element lives in an anchor wired the way the editor controller wires it:
 * refreshed on every local edit, followed on every doc-driven change.
 */
function openTab(doc, { surface, selectedElement = null }) {
  const p = pres();
  const anchor = createElementAnchor({
    getSlide: () => p.slides[0],
    slideTypes: SLIDE_TYPES,
  });
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres: p,
    getActiveLang: () => p.i18n.active,
    onRemoteApplied: () => anchor.follow(),
  });
  binder.attach();
  anchor.set(selectedElement);
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const noop = () => {};
  const deps = {
    pres: p,
    user: {},
    markDirty: () => {
      anchor.refresh();
      binder.syncLocal();
    },
    scheduleUiRefresh: noop,
    rerenderEditor: noop,
    updateSelectedSlideListItem: noop,
    normalizeLang: (l) => l,
  };
  const editor = createRerenderEditor({
    ...deps,
    editorMount,
    SLIDE_TYPES,
    api: null,
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: noop,
    editorState: {},
    requestSave: noop,
    rerenderSlideList: noop,
    rerenderPreview: noop,
    fieldRenderers: createFieldRenderers(deps),
    surface,
    getSelectedElement: () => anchor.get(),
  });
  editor.rerender();
  return { pres: p, binder, editorMount, anchor, rerender: editor.rerender };
}

/** Two docs that relay every update to each other, as the provider does. */
function linkedDocs() {
  const a = new Y.Doc();
  codec.bootstrapPresentationToDoc(pres(), a);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.on('update', (u, origin) => {
    if (origin !== 'relay') Y.applyUpdate(b, u, 'relay');
  });
  b.on('update', (u, origin) => {
    if (origin !== 'relay') Y.applyUpdate(a, u, 'relay');
  });
  return { a, b };
}

/** `[title, color]` per row, from the doc. */
function rows(doc) {
  const out = codec.projectDocToPresentation(doc);
  return out.i18n.versions.nl.slides[0].content.rows.map((r) => [
    r.title,
    r.color,
  ]);
}

const listRows = (mount) =>
  Array.from(mount.querySelector('.items-reorder-list').children).filter((c) =>
    c.classList.contains('card-group'),
  );

/** Tab B moves its first row one down (keyboard path of the drag handle). */
function moveFirstRowDown(tab) {
  listRows(tab.editorMount)[0]
    .querySelector('.item-drag-handle')
    .dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
      }),
    );
}

const colorField = (mount) =>
  [...mount.querySelectorAll('.editor-element-form .is-field')].find(
    (f) => f.querySelector('.field-label')?.textContent.trim() === 'Color',
  );

// A segmented button or a dropdown, whichever the options fit (B457).
function pick(field, value) {
  const select = field.querySelector('select');
  if (select) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  field
    .querySelector(`[data-value="${value}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

test('the selection follows its row after a remote move', () => {
  const { a, b } = linkedDocs();
  const tabA = openTab(a, {
    surface: 'inspector',
    selectedElement: { kind: 'card', idx: 0 },
  });
  const tabB = openTab(b, { surface: 'library' });

  moveFirstRowDown(tabB);
  assert.deepEqual(rows(a), [
    ['Two', 'yellow'],
    ['One', 'yellow'],
  ]);
  assert.deepEqual(tabA.anchor.get(), { kind: 'card', idx: 1 });

  // The rebuilt inspector shows row "One" again: its colour lands there.
  tabA.rerender();
  pick(colorField(tabA.editorMount), 'black');
  assert.deepEqual(rows(b), [
    ['Two', 'yellow'],
    ['One', 'black'],
  ]);

  tabA.binder.detach();
  tabB.binder.detach();
});

test('a local edit to the selected row does not lose it on the next move', () => {
  const { a, b } = linkedDocs();
  const tabA = openTab(a, {
    surface: 'inspector',
    selectedElement: { kind: 'card', idx: 0 },
  });
  const tabB = openTab(b, { surface: 'library' });

  pick(colorField(tabA.editorMount), 'black');
  moveFirstRowDown(tabB);
  assert.deepEqual(rows(a), [
    ['Two', 'yellow'],
    ['One', 'black'],
  ]);
  assert.deepEqual(tabA.anchor.get(), { kind: 'card', idx: 1 });

  tabA.binder.detach();
  tabB.binder.detach();
});

test('the selection clears when a collaborator removes its row', () => {
  const { a, b } = linkedDocs();
  const tabA = openTab(a, {
    surface: 'inspector',
    selectedElement: { kind: 'card', idx: 0 },
  });
  const tabB = openTab(b, { surface: 'library' });

  listRows(tabB.editorMount)[0].querySelector('.card-remove-btn').click();
  assert.deepEqual(rows(a), [['Two', 'yellow']]);
  assert.equal(tabA.anchor.get(), null, 'not handed to the row that remains');

  tabA.rerender();
  assert.equal(colorField(tabA.editorMount), undefined);

  tabA.binder.detach();
  tabB.binder.detach();
});

test('a remote change elsewhere leaves the selection where it is', () => {
  const { a, b } = linkedDocs();
  const tabA = openTab(a, {
    surface: 'inspector',
    selectedElement: { kind: 'card', idx: 1 },
  });
  const tabB = openTab(b, {
    surface: 'inspector',
    selectedElement: { kind: 'card', idx: 0 },
  });

  pick(colorField(tabB.editorMount), 'black');
  assert.deepEqual(rows(a), [
    ['One', 'black'],
    ['Two', 'yellow'],
  ]);
  assert.deepEqual(tabA.anchor.get(), { kind: 'card', idx: 1 });

  tabA.binder.detach();
  tabB.binder.detach();
});

test('a row selected through its title keeps the title path in step', () => {
  const { a, b } = linkedDocs();
  const tabA = openTab(a, {
    surface: 'inspector',
    selectedElement: { kind: 'card', idx: 0, fieldKey: 'rows.0.title' },
  });
  const tabB = openTab(b, { surface: 'library' });

  moveFirstRowDown(tabB);
  assert.deepEqual(tabA.anchor.get(), {
    kind: 'card',
    idx: 1,
    fieldKey: 'rows.1.title',
  });

  tabA.binder.detach();
  tabB.binder.detach();
});
