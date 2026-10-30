/**
 * A form rendered before a collaborator moved an item writes into that item,
 * not into whatever item now holds its position (DY-781).
 *
 * The SL-20 trial on slides.ciiic.nl: tab A edits the English version in the
 * Fields form, tab B the Dutch one. B drags the first team card below the
 * second; A's canvas follows, but its form still shows the old order while
 * the caret is in it. A then types in the field that shows "EN-A", and the
 * collection editor wrote the whole field value into `members[0]` - which by
 * then was EN-B. EN-B's name was gone, in the data.
 *
 * Here two editors share one live doc the way the browser tabs do: each a
 * `pres`, a live-doc binder and the real collection editor, the doc updates
 * relayed between them. The form of tab A is not rebuilt after B's move,
 * exactly as under a caret.
 *
 * Run with: node --test tests/collab-fields-form-remote-reorder.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec } = await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } =
  await import('../client/views/editor/live-edits/live-doc-binder.js');
const { createFieldRenderers } =
  await import('../client/views/editor/fields/index.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form/index.js');
const { locateItem } =
  await import('../client/views/editor/editor-form/collection-editor.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

const codec = createDeckYdocCodec(Y);

function teamSlide(names) {
  return {
    id: 's1',
    type: 'team-cards-slide',
    notes: '',
    content: {
      title: 'Team',
      members: names.map((name, i) => ({
        image: i === 0 ? 'https://example.test/a.jpg' : '',
        alt: i === 0 ? `${name} alt` : '',
        imageFocusX: 50,
        imageFocusY: 50,
        name,
        byline: `${name} byline`,
        body: '',
        linkedin: '',
      })),
    },
  };
}

function bilingualPres(active) {
  const nl = [teamSlide(['NL-A', 'NL-B'])];
  const en = [teamSlide(['EN-A', 'EN-B'])];
  return {
    id: 'p1',
    title: 'Deck',
    lang: 'nl',
    theme: 'default',
    visibility: 'private',
    slides: active === 'nl' ? nl : en,
    i18n: {
      dominant: 'nl',
      active,
      versions: {
        nl: { title: 'Deck', slides: nl },
        'en-GB': { title: 'Deck', slides: en },
      },
    },
  };
}

/** One browser tab: its own doc, pres, binder and rendered form. */
function openTab(doc, lang) {
  const pres = bilingualPres(lang);
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => pres.i18n.active,
  });
  binder.attach();
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const noop = () => {};
  const markDirty = () => binder.syncLocal();
  const deps = {
    pres,
    user: {},
    markDirty,
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
    surface: 'library',
  }).rerender();
  return { pres, binder, editorMount };
}

/** Two docs that relay every update to each other, as the provider does. */
function linkedDocs() {
  const a = new Y.Doc();
  codec.bootstrapPresentationToDoc(bilingualPres('nl'), a);
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

const rowsOf = (mount) =>
  Array.from(mount.querySelector('.items-reorder-list').children).filter((c) =>
    c.classList.contains('card-group'),
  );

/** The input in a rendered row that shows `value`. */
function inputShowing(mount, value) {
  for (const row of rowsOf(mount)) {
    const input = Array.from(row.querySelectorAll('input')).find(
      (el) => el.value === value,
    );
    if (input) return input;
  }
  return null;
}

/** `[name, image]` per member of one language, from the doc. */
function members(doc, lang) {
  const out = codec.projectDocToPresentation(doc);
  return out.i18n.versions[lang].slides[0].content.members.map((m) => [
    m.name,
    m.image,
  ]);
}

test('an edit in a form rendered before a remote move lands in its own item', () => {
  const { a, b } = linkedDocs();
  const tabA = openTab(a, 'en-GB');
  const tabB = openTab(b, 'nl');

  // Tab B drags the first card below the second (keyboard path of the
  // same pointer-sortable handle).
  rowsOf(tabB.editorMount)[0]
    .querySelector('.item-drag-handle')
    .dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
      }),
    );
  assert.deepEqual(members(a, 'nl'), [
    ['NL-B', ''],
    ['NL-A', 'https://example.test/a.jpg'],
  ]);
  assert.deepEqual(
    members(a, 'en-GB'),
    [
      ['EN-B', ''],
      ['EN-A', 'https://example.test/a.jpg'],
    ],
    'the English card moves with its photo',
  );
  assert.deepEqual(
    tabA.pres.slides[0].content.members.map((m) => m.name),
    ['EN-B', 'EN-A'],
    "tab A's model follows the move",
  );

  // Tab A's form was not rebuilt: it still shows EN-A first. Type there.
  const input = inputShowing(tabA.editorMount, 'EN-A');
  assert.ok(input, 'the stale form still shows EN-A');
  assert.equal(
    rowsOf(tabA.editorMount).indexOf(input.closest('.card-group')),
    0,
  );
  input.value = 'EN-Ax';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  assert.deepEqual(
    members(b, 'en-GB'),
    [
      ['EN-B', ''],
      ['EN-Ax', 'https://example.test/a.jpg'],
    ],
    'EN-B is intact; the edit landed in EN-A',
  );
  assert.deepEqual(
    members(b, 'nl'),
    [
      ['NL-B', ''],
      ['NL-A', 'https://example.test/a.jpg'],
    ],
    'the Dutch version is untouched',
  );

  // The row keeps following its item on the next keystroke too.
  input.value = 'EN-Axy';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(
    members(b, 'en-GB').map(([name]) => name),
    ['EN-B', 'EN-Axy'],
  );

  tabA.binder.detach();
  tabB.binder.detach();
});

test('a remove in a form rendered before a remote move removes its own item', () => {
  const { a, b } = linkedDocs();
  const tabA = openTab(a, 'en-GB');
  const tabB = openTab(b, 'nl');
  rowsOf(tabB.editorMount)[0]
    .querySelector('.item-drag-handle')
    .dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
      }),
    );
  // Row 0 of tab A's stale form shows EN-A; its remove removes EN-A.
  rowsOf(tabA.editorMount)[0].querySelector('.card-remove-btn').click();
  assert.deepEqual(
    members(b, 'en-GB').map(([name]) => name),
    ['EN-B'],
  );
  assert.deepEqual(
    members(b, 'nl').map(([name]) => name),
    ['NL-B'],
    'the item goes in every language',
  );
  tabA.binder.detach();
  tabB.binder.detach();
});

test('locateItem: in place, moved, edited in place, and stale', () => {
  const A = { name: 'A', role: 'r' };
  const B = { name: 'B', role: 'r' };
  const rows = [
    { at: 0, shown: A },
    { at: 1, shown: B },
  ];
  assert.equal(locateItem([A, B], rows, 0), 0, 'unchanged');
  assert.equal(
    locateItem([{ role: 'r', name: 'A' }, B], rows, 0),
    0,
    'key order does not matter',
  );
  assert.equal(locateItem([B, A], rows, 0), 1, 'moved');
  assert.equal(locateItem([B, A], rows, 1), 0, 'moved, the other row');
  assert.equal(
    locateItem([{ ...A, role: 'x' }, B], rows, 0),
    0,
    'edited in place by a collaborator',
  );
  assert.equal(
    locateItem([B, { ...A, role: 'x' }], rows, 0),
    -1,
    'moved and edited: its index holds the other row',
  );
  assert.equal(locateItem([B], rows, 0), -1, 'removed');
  assert.equal(
    locateItem(
      [A, A],
      [
        { at: 0, shown: B },
        { at: 1, shown: A },
      ],
      0,
    ),
    -1,
    'gone, and its index holds a twin of another row',
  );
});
