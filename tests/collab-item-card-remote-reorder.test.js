/**
 * The inspector's "This card" writes into the item it shows, also after a
 * collaborator changed the list under it (B892).
 *
 * The card used to hold the item object it rendered and write into it. The
 * live-doc binder replaces `slide.content` on a remote change, so after a
 * collaborator's move that object was no longer in the slide: the edit went
 * nowhere, silently. It now finds its item in the list as it stands, by the
 * same rule as the Fields form (`locateItem`, DY-781), and rebuilds instead
 * of writing when it cannot.
 *
 * Two editors share one live doc the way two browser tabs do; tab A shows
 * the inspector with a row selected, tab B moves rows in its Fields form.
 *
 * Run with: node --test tests/collab-item-card-remote-reorder.test.js
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

/** One browser tab: its own doc, pres, binder and rendered form. */
function openTab(doc, { surface, selectedElement = null }) {
  const p = pres();
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres: p,
    getActiveLang: () => p.i18n.active,
  });
  binder.attach();
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const noop = () => {};
  const deps = {
    pres: p,
    user: {},
    markDirty: () => binder.syncLocal(),
    scheduleUiRefresh: noop,
    rerenderEditor: noop,
    updateSelectedSlideListItem: noop,
    normalizeLang: (l) => l,
  };
  createRerenderEditor({
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
    getSelectedElement: () => selectedElement,
  }).rerender();
  return { pres: p, binder, editorMount };
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

test('"This row" rendered before a remote move writes into its own row', () => {
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

  // Tab A's card still shows row "One"; change its colour there.
  const field = colorField(tabA.editorMount);
  pick(field, 'black');
  assert.deepEqual(
    rows(b),
    [
      ['Two', 'yellow'],
      ['One', 'black'],
    ],
    'the colour lands in "One", where it now stands',
  );

  // And on the next edit too.
  pick(field, 'yellow');
  assert.deepEqual(rows(b), [
    ['Two', 'yellow'],
    ['One', 'yellow'],
  ]);
  assert.ok(field.isConnected, 'a located item needs no rebuild');

  tabA.binder.detach();
  tabB.binder.detach();
});

test('"This row" whose row a collaborator removed rebuilds instead of writing', () => {
  const { a, b } = linkedDocs();
  const tabA = openTab(a, {
    surface: 'inspector',
    selectedElement: { kind: 'card', idx: 0 },
  });
  const tabB = openTab(b, { surface: 'library' });

  listRows(tabB.editorMount)[0].querySelector('.card-remove-btn').click();
  assert.deepEqual(rows(a), [['Two', 'yellow']]);

  const field = colorField(tabA.editorMount);
  pick(field, 'black');
  assert.deepEqual(
    rows(b),
    [['Two', 'yellow']],
    'the colour does not land in the row that took its place',
  );
  assert.ok(!field.isConnected, 'the stale card is rebuilt');

  tabA.binder.detach();
  tabB.binder.detach();
});
