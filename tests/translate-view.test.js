/**
 * The translation view (B763): the whole deck as rows of source | target per
 * text field, both editable, through the write seam for any language (B762).
 *
 * Pinned here:
 *  - the rows are the paths of `slideTextRows`, and with the filter on they
 *    are exactly the paths `computeMissingTranslation` counts;
 *  - a target slide is matched on id, never on index (B762 review 5);
 *  - the lock asked is that of the slide written, in both columns, and an
 *    active write selects that slide first (review 2);
 *  - a refused write leaves no optimistic text (review 2);
 *  - the change signal refreshes fields without focus, keeps the focused one
 *    and is dropped on close (review 3);
 *  - both columns are inert before the live doc is ready (review 4);
 *  - with the real binder: a peer's edit and an undo in the inactive
 *    language reach the view, deck title included.
 *
 * Run with: node --test tests/translate-view.test.js
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
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;

const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec } = await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } =
  await import('../client/views/editor/live-edits/live-doc-binder.js');
const { createVersionTextSignal, createVersionTextWriter } =
  await import('../client/views/editor/version-text.js');
const { openTranslateView, canOpenTranslateView } =
  await import('../client/views/editor/translate-view/index.js');
const { translateViewModel, onlyEmptyTargets, defaultLanguagePair } =
  await import('../client/views/editor/translate-view/model.js');
const { computeMissingTranslation, slideTextRows, pickVersion } =
  await import('../shared/i18n-progress.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

const normalizeLang = (l) => (l === 'nl' || l === 'en-GB' ? l : null);

const listSlide = (id, title, items) => ({
  id,
  type: 'list-slide',
  notes: '',
  content: { title, items },
});

/** A bilingual deck edited in Dutch; English half translated, one slide short. */
function bilingualPres() {
  const nl = [
    listSlide('s1', 'Waarom', [
      { title: 'Snel', text: 'Binnen een dag' },
      { title: 'Open', text: 'Broncode op GitHub' },
    ]),
    listSlide('s2', 'Hoe', [{ title: 'Stap', text: 'Eerst dit' }]),
  ];
  return {
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: nl,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Deck', slides: nl },
        'en-GB': {
          title: '',
          slides: [
            listSlide('s1', 'Why', [
              { title: 'Fast', text: '' },
              { title: '', text: '' },
            ]),
            listSlide('s2', '', [{ title: '', text: '' }]),
          ],
        },
      },
    },
  };
}

const paths = (rows) => rows.map((r) => JSON.stringify([r.slideId, r.path]));

// ── model ────────────────────────────────────────────────────────────────

test('model: the rows are the paths of slideTextRows', () => {
  const pres = bilingualPres();
  const model = translateViewModel({
    pres,
    source: 'nl',
    target: 'en-GB',
    activeLang: 'nl',
    slideTypes: SLIDE_TYPES,
  });
  const walked = slideTextRows(
    pickVersion(pres, 'nl'),
    pickVersion(pres, 'en-GB'),
    { slideTypes: SLIDE_TYPES },
  );
  assert.deepEqual(
    paths([model.deck, ...model.slides.flatMap((s) => s.rows)]),
    paths(walked),
  );
  assert.ok(
    model.slides[0].rows.some((r) => r.path.join('.') === 'items.1.title'),
    'item texts are rows',
  );
});

test('model: the filter keeps exactly what computeMissingTranslation counts', () => {
  const pres = bilingualPres();
  const model = translateViewModel({
    pres,
    source: 'nl',
    target: 'en-GB',
    activeLang: 'nl',
    slideTypes: SLIDE_TYPES,
  });
  const filtered = onlyEmptyTargets(model);
  const shown = [
    ...(filtered.deck ? [filtered.deck] : []),
    ...filtered.slides.flatMap((s) => s.rows),
  ];
  const { missing } = computeMissingTranslation({
    source: pickVersion(pres, 'nl'),
    target: pickVersion(pres, 'en-GB'),
    slideTypes: SLIDE_TYPES,
  });
  const key = (r) =>
    JSON.stringify([r.kind === 'deck' ? null : r.slideId, r.path || [r.key]]);
  assert.deepEqual(shown.map(key), missing.map(key));
  assert.ok(missing.length > 3, 'the fixture has something to count');
});

test('model: a target slide is matched on id, not on its index', () => {
  const pres = bilingualPres();
  // The English version holds another slide at index 1.
  pres.i18n.versions['en-GB'].slides[1] = listSlide('other', 'Elsewhere', []);
  const model = translateViewModel({
    pres,
    source: 'nl',
    target: 'en-GB',
    activeLang: 'nl',
  });
  const s2 = model.slides.find((s) => s.slideId === 's2');
  assert.equal(s2.only, 'source');
  assert.deepEqual(s2.rows, [], 'no text of the slide at that index');
  const other = model.slides.find((s) => s.slideId === 'other');
  assert.equal(other.only, 'target', 'a slide only the target holds is listed');
});

test('model: the active version is read from pres, not its lagging buffer', () => {
  const pres = bilingualPres();
  pres.i18n.versions.nl = { title: 'Old', slides: [] };
  const model = translateViewModel({
    pres,
    source: 'nl',
    target: 'en-GB',
    activeLang: 'nl',
  });
  assert.equal(model.deck.source, 'Deck');
  assert.equal(model.slides.length, 2);
});

test('model: the pair opens on the source version (dominant)', () => {
  const pres = bilingualPres();
  pres.i18n.active = 'en-GB';
  assert.deepEqual(defaultLanguagePair(pres, 'en-GB'), {
    langs: ['nl', 'en-GB'],
    source: 'nl',
    target: 'en-GB',
  });
  delete pres.i18n.versions['en-GB'];
  pres.i18n.active = 'nl';
  assert.equal(canOpenTranslateView(pres, normalizeLang), false);
});

// ── view with stand-in deps ──────────────────────────────────────────────

/** Open the view over a pres with a recording write and controllable state. */
function openWith(pres, overrides = {}) {
  const signal = createVersionTextSignal();
  const calls = { writes: [], selected: [] };
  let selected = 's1';
  const state = { ready: true, locks: {}, readOnly: false };
  const realWrite = createVersionTextWriter({
    pres,
    normalizeLang,
    markDirty: () => (state.locks[selected] ? false : undefined),
  });
  const view = openTranslateView({
    root: document.body,
    pres,
    slideTypes: SLIDE_TYPES,
    normalizeLang,
    write: (...args) => {
      calls.writes.push(args);
      return realWrite(...args);
    },
    canWrite: () => state.ready,
    subscribe: signal.subscribe,
    getSlideLockKind: (id) => state.locks[id] || null,
    isReadOnly: () => state.readOnly,
    getSelectedSlideId: () => selected,
    selectSlide: (id) => {
      selected = id;
      calls.selected.push(id);
    },
    ...overrides,
  });
  const field = (lang, slideId, path) =>
    [...document.querySelectorAll('.translate-view-input')].find(
      (el) =>
        el.lang === lang &&
        el.closest('section')?.dataset.slideId === (slideId ?? undefined) &&
        el.getAttribute('aria-label').startsWith(path),
    );
  const type = (el, value) => {
    el.value = value;
    el.dispatchEvent(new dom.window.Event('input'));
  };
  return { view, signal, calls, state, field, type };
}

const cleanup = () => document.body.replaceChildren();

test('view: typing in the target writes that language at that path', () => {
  const pres = bilingualPres();
  const { view, calls, field, type } = openWith(pres);
  const cell = field('en-GB', 's1', 'Items 2 · Title');
  assert.ok(cell, 'an item text has a row of its own');
  type(cell, 'Open');
  assert.deepEqual(calls.writes.at(-1), [
    'en-GB',
    's1',
    ['items', 1, 'title'],
    'Open',
    { sourceLang: 'nl' },
  ]);
  assert.equal(
    pres.i18n.versions['en-GB'].slides[0].content.items[1].title,
    'Open',
  );
  assert.deepEqual(calls.selected, [], 'an inactive write selects nothing');
  view.close();
  cleanup();
});

test('view: an active write selects the slide it writes first', () => {
  const pres = bilingualPres();
  const { view, calls, field, type } = openWith(pres);
  type(field('nl', 's2', 'Title'), 'Hoe het werkt');
  assert.deepEqual(calls.selected, ['s2']);
  assert.equal(pres.slides[1].content.title, 'Hoe het werkt');
  view.close();
  cleanup();
});

test('view: a locked slide is inert and a write to it leaves no text', () => {
  const pres = bilingualPres();
  const { view, calls, state, signal, field, type } = openWith(pres);
  state.locks.s2 = 'other';
  signal.emit();
  const cell = field('en-GB', 's2', 'Title');
  assert.equal(cell.readOnly, true);
  assert.equal(
    cell.closest('section').querySelector('.translate-view-lock').hidden,
    false,
    'the lock is named on the slide',
  );
  assert.equal(field('en-GB', 's1', 'Title').readOnly, false, 'others stay');
  type(cell, 'How');
  assert.equal(calls.writes.length, 0, 'the lock is asked before the write');
  assert.equal(cell.value, '', 'no optimistic text');
  assert.equal(cell.getAttribute('aria-invalid'), 'true');
  view.close();
  cleanup();
});

test('view: a write the seam refuses goes back to what is stored', () => {
  const pres = bilingualPres();
  const { view, field, type } = openWith(pres, { write: () => false });
  const cell = field('en-GB', 's1', 'Title');
  type(cell, 'Because');
  assert.equal(cell.value, 'Why');
  assert.ok(
    cell.closest('.translate-view-cell').querySelector('.inline-error'),
    'the refusal is said beside the field',
  );
  view.close();
  cleanup();
});

test('view: a refused active write (lock taken meanwhile) leaves no text', () => {
  const pres = bilingualPres();
  // The lock manager learns of the lock only when the edit asks for it.
  const { view, state, field, type } = openWith(pres, {
    getSlideLockKind: () => null,
  });
  state.locks.s1 = 'other';
  const cell = field('nl', 's1', 'Title');
  type(cell, 'Waarom wij');
  assert.equal(cell.value, 'Waarom', 'back to what is stored');
  view.close();
  cleanup();
});

test('view: inert before the live doc is ready, editable once it is', () => {
  const pres = bilingualPres();
  const { view, state, signal, calls, field, type } = openWith(pres);
  state.ready = false;
  signal.emit();
  const status = document.querySelector('.translate-view-status');
  assert.equal(status.hidden, false, 'the wait is said');
  const cell = field('en-GB', 's1', 'Title');
  assert.equal(cell.readOnly, true);
  assert.equal(field('nl', 's1', 'Title').readOnly, true, 'both columns');
  type(cell, 'Because');
  assert.equal(calls.writes.length, 0);
  assert.equal(cell.value, 'Why');

  state.ready = true;
  signal.emit();
  assert.equal(status.hidden, true);
  assert.equal(cell.readOnly, false);
  type(cell, 'Because');
  assert.equal(calls.writes.length, 1);
  view.close();
  cleanup();
});

test('view: the signal refreshes fields without focus and keeps the focused one', () => {
  const pres = bilingualPres();
  const { view, signal, field } = openWith(pres);
  const focused = field('en-GB', 's1', 'Title');
  const other = field('en-GB', 's2', 'Title');
  focused.focus();
  focused.value = 'Wh';
  pres.i18n.versions['en-GB'].slides[0].content.title = 'Why us';
  pres.i18n.versions['en-GB'].slides[1].content.title = 'How';
  signal.emit();
  assert.equal(other.value, 'How', 'refreshed in place');
  assert.equal(focused.value, 'Wh', 'the focused field keeps its input');
  assert.equal(document.activeElement, focused);
  view.close();
  cleanup();
});

test('view: a missing target slide is a notice, without fields', () => {
  const pres = bilingualPres();
  pres.i18n.versions['en-GB'].slides[1] = listSlide('other', 'Elsewhere', []);
  const { view } = openWith(pres);
  const s2 = document.querySelector('section[data-slide-id="s2"]');
  assert.ok(s2.querySelector('.translate-view-only'));
  assert.equal(s2.querySelectorAll('.translate-view-input').length, 0);
  assert.ok(
    !s2.textContent.includes('Elsewhere'),
    'the slide at that index is not shown as s2',
  );
  view.close();
  cleanup();
});

test('view: the filter shows empty targets and keeps a row while you type', () => {
  const pres = bilingualPres();
  const { view, signal, field, type } = openWith(pres);
  const box = document.querySelector('.translate-view-filter');
  box.value = 'empty';
  box.dispatchEvent(new dom.window.Event('change'));
  assert.equal(field('en-GB', 's1', 'Title'), undefined, 'a filled row hides');
  const cell = field('en-GB', 's2', 'Title');
  assert.ok(cell, 'an empty row shows');
  type(cell, 'How');
  signal.emit();
  assert.ok(field('en-GB', 's2', 'Title'), 'still there after filling it');
  view.close();
  cleanup();
});

test('view: closing drops the subscription', () => {
  const pres = bilingualPres();
  let subscribed = 0;
  const signal = createVersionTextSignal();
  const { view } = openWith(pres, {
    subscribe: (fn) => {
      subscribed += 1;
      const off = signal.subscribe(fn);
      return () => {
        subscribed -= 1;
        off();
      };
    },
  });
  assert.equal(subscribed, 1);
  view.close();
  assert.equal(subscribed, 0);
  cleanup();
});

// ── with the real binder (collab) ────────────────────────────────────────

/** Two collab clients on linked docs; A has the view open. */
function linkedClients() {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  docA.on(
    'update',
    (u, origin) => origin !== 'peer' && Y.applyUpdate(docB, u, 'peer'),
  );
  docB.on(
    'update',
    (u, origin) => origin !== 'peer' && Y.applyUpdate(docA, u, 'peer'),
  );
  const presA = bilingualPres();
  createDeckYdocCodec(Y).bootstrapPresentationToDoc(presA, docA);
  const presB = bilingualPres();
  const signal = createVersionTextSignal();
  const client = (doc, pres, onVersionsChanged) => {
    const binder = createLiveDocBinder({
      Y,
      doc,
      codec: createDeckYdocCodec(Y),
      pres,
      getActiveLang: () => normalizeLang(pres.i18n.active),
      onVersionsChanged,
    });
    binder.attach();
    const write = createVersionTextWriter({
      pres,
      normalizeLang,
      markDirty: () => binder.syncLocal(),
      liveEditsActive: true,
      getLiveEdits: () => ({ writeVersionText: binder.writeVersionText }),
    });
    return { binder, write };
  };
  const a = client(docA, presA, signal.emit);
  const b = client(docB, presB);
  return { presA, presB, a, b, signal };
}

test('collab: a peer edit in the inactive language reaches the view, title too', () => {
  const { presA, a, b, signal } = linkedClients();
  const { view, field } = openWith(presA, {
    write: a.write,
    subscribe: signal.subscribe,
  });
  b.write('en-GB', 's1', ['items', 1, 'title'], 'Open');
  b.write('en-GB', null, ['title'], 'Deck EN');
  assert.equal(field('en-GB', 's1', 'Items 2 · Title').value, 'Open');
  const title = [...document.querySelectorAll('.translate-view-input')].find(
    (el) => el.lang === 'en-GB' && el.closest('section.is-deck'),
  );
  assert.equal(title.value, 'Deck EN');
  view.close();
  a.binder.detach();
  b.binder.detach();
  cleanup();
});

test('collab: undo and redo of an inactive write show in the view', () => {
  const { presA, a, b, signal } = linkedClients();
  const { view, field, type } = openWith(presA, {
    write: a.write,
    subscribe: signal.subscribe,
    history: {
      undo: () => a.binder.undo(),
      redo: () => a.binder.redo(),
      canUndo: () => a.binder.canUndo(),
      canRedo: () => a.binder.canRedo(),
    },
  });
  const cell = field('en-GB', 's2', 'Title');
  type(cell, 'How');
  cell.blur();
  assert.equal(presA.i18n.versions['en-GB'].slides[1].content.title, 'How');
  const [undoBtn, redoBtn] = document.querySelectorAll(
    '.translate-view-history button',
  );
  undoBtn.click();
  assert.equal(field('en-GB', 's2', 'Title').value, '', 'undone in the view');
  redoBtn.click();
  assert.equal(field('en-GB', 's2', 'Title').value, 'How', 'redone');
  view.close();
  a.binder.detach();
  b.binder.detach();
  cleanup();
});

test('navigation: index status follows all rows and frozen filter follows shown slides', () => {
  const pres = bilingualPres();
  const { view, signal, field, type } = openWith(pres);
  const items = () => [
    ...document.querySelectorAll('.translate-view-index-item'),
  ];
  assert.equal(items().length, 2);
  assert.ok(items()[0].querySelector('.is-partial'));
  assert.ok(items()[1].querySelector('.is-empty'));
  for (const row of pres.i18n.versions['en-GB'].slides[0].content.items) {
    row.title = 'Done';
    row.text = 'Done';
  }
  signal.emit();
  assert.ok(items()[0].querySelector('.is-complete'));
  const box = document.querySelector('.translate-view-filter');
  box.value = 'empty';
  box.dispatchEvent(new dom.window.Event('change'));
  assert.equal(items().length, 1);
  items()[0].click();
  type(field('en-GB', 's2', 'Title'), 'How');
  signal.emit();
  assert.equal(items().length, 1, 'index freezes alongside fields');
  view.close();
  cleanup();
});

test('navigation: index, keyboard and field focus use selection; typing keys stay local', () => {
  const { view, calls, field } = openWith(bilingualPres());
  const items = [...document.querySelectorAll('.translate-view-index-item')];
  items[1].click();
  assert.deepEqual(calls.selected, ['s2']);
  assert.equal(items[1].getAttribute('aria-current'), 'true');
  items[1].dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
  );
  assert.deepEqual(calls.selected, ['s2', 's1']);
  const cell = field('en-GB', 's2', 'Title');
  cell.focus();
  assert.equal(calls.selected.at(-1), 's2', 'inactive field focus selects too');
  cell.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
  );
  assert.equal(
    calls.selected.at(-1),
    's2',
    'cursor keys do not navigate from text',
  );
  view.close();
  assert.equal(calls.selected.at(-1), 's2', 'closing keeps last selection');
  cleanup();
});

test('navigation: refused selection keeps current index; detach cancels scroll work', async () => {
  const { view } = openWith(bilingualPres(), { selectSlide: () => false });
  const items = [...document.querySelectorAll('.translate-view-index-item')];
  items[1].click();
  assert.equal(items[0].getAttribute('aria-current'), 'true');
  assert.equal(items[1].hasAttribute('aria-current'), false);
  document
    .querySelector('.translate-view-body')
    .dispatchEvent(new dom.window.Event('scroll'));
  view.close();
  await new Promise((resolve) => setTimeout(resolve, 5));
  cleanup();
});

test('navigation: a jump clamped at the bottom keeps requested last slide', async () => {
  const { view, calls } = openWith(bilingualPres());
  const body = document.querySelector('.translate-view-body');
  const sections = [...body.querySelectorAll('section[data-slide-id]')];
  body.getBoundingClientRect = () => ({ top: 0 });
  sections[0].getBoundingClientRect = () => ({ top: 0, bottom: 200 });
  sections[1].getBoundingClientRect = () => ({ top: 200, bottom: 400 });
  Object.defineProperty(body, 'scrollTop', {
    get: () => 0,
    set: () => {},
    configurable: true,
  });
  document.querySelector('.translate-view-index-item:last-child').click();
  body.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.selected.at(-1), 's2');
  assert.equal(
    document.querySelector('.translate-view-index-item[aria-current]')
      .textContent,
    '2',
  );
  view.close();
  cleanup();
});

test('navigation: an own write refreshes the index status without a signal', () => {
  const { view, type } = openWith(bilingualPres());
  const dot = () =>
    document.querySelectorAll('.translate-view-index-item')[1].lastElementChild
      .className;
  assert.match(dot(), /is-empty/);
  const targets = [
    ...document
      .querySelector('section[data-slide-id="s2"]')
      .querySelectorAll('.translate-view-input'),
  ].filter((el) => el.lang === 'en-GB');
  for (const el of targets) type(el, 'Done');
  assert.match(dot(), /is-complete/, 'the dot follows the write, unprompted');
  view.close();
  cleanup();
});

test('navigation: the caret holds the selection until its slide leaves the view', async () => {
  const { view, calls, field } = openWith(bilingualPres());
  const body = document.querySelector('.translate-view-body');
  const section = (id) => body.querySelector(`section[data-slide-id="${id}"]`);
  body.getBoundingClientRect = () => ({ top: 0, bottom: 100 });
  body.querySelector('.translate-view-head').getBoundingClientRect = () => ({
    height: 0,
  });
  // s1 sits at the top of the viewport, s2 below it but still in view.
  section('s1').getBoundingClientRect = () => ({ top: -60, bottom: 40 });
  section('s2').getBoundingClientRect = () => ({ top: 40, bottom: 140 });
  field('nl', 's2', 'Title').focus();
  assert.equal(calls.selected.at(-1), 's2', 'focus selects the slide typed in');
  body.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    calls.selected.at(-1),
    's2',
    'the scroll that focus caused does not hand s1 the selection',
  );
  // Scroll s2 out of view: the viewport takes over again.
  section('s2').getBoundingClientRect = () => ({ top: 200, bottom: 300 });
  body.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.selected.at(-1), 's1');
  view.close();
  cleanup();
});

test('view: statuses follow source edits and filters match rows and index', () => {
  const pres = bilingualPres();
  const { view, signal, field, type } = openWith(pres);
  const target = field('en-GB', 's1', 'Title');
  assert.match(target.parentElement.textContent, /No history/);
  type(target, 'Why us');
  assert.match(target.parentElement.textContent, /Current/);
  pres.slides[0].content.title = 'Waarom nu';
  signal.emit();
  assert.match(target.parentElement.textContent, /Source changed/);
  const filter = document.querySelector('.translate-view-filter');
  filter.value = 'changed';
  filter.dispatchEvent(new dom.window.Event('change'));
  assert.equal(document.querySelectorAll('.translate-view-input').length, 2);
  assert.equal(
    document.querySelectorAll('.translate-view-index-item').length,
    1,
  );
  type(field('en-GB', 's1', 'Title'), 'Waarom nu');
  assert.match(
    field('en-GB', 's1', 'Title').parentElement.textContent,
    /Same as source/,
  );
  filter.value = 'same';
  filter.dispatchEvent(new dom.window.Event('change'));
  assert.ok(field('en-GB', 's1', 'Title'));
  view.close();
  cleanup();
});
