/**
 * Item settings get a home outside "All text" (B450, D313).
 *
 * A collection item's settings - text-blocks' row colour and the arrow to the
 * next row, a matrix cell's tone - had the bulk modal as their only home. The
 * type now declares them on its `card` element tab (`fields`), a click inside
 * the item selects it, and the inspector renders them in the shared
 * "This card" card. Both halves run for real here: the inline editor on a
 * real render, and the inspector form.
 *
 * Run with: node --test tests/item-element-card.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/p1',
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
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver =
  dom.window.IntersectionObserver || NoopObserver;
globalThis.ResizeObserver = dom.window.ResizeObserver || NoopObserver;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { renderSlideElement, NO_DECK_LANG } =
  await import('../client/lib/slide-runtime/slide-render.js');
const { createInlineEditor } =
  await import('../client/views/editor/inline-edit/inline-editor.js');
const { createFieldRenderers } =
  await import('../client/views/editor/fields/index.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form/index.js');

const ROWS = [
  { title: 'One', color: 'yellow', arrow: 'down', blocks: [{ title: 'A' }] },
  { title: 'Two', color: 'black', arrow: 'none', blocks: [{ title: 'B' }] },
];

function textBlocksSlide() {
  return {
    id: 's1',
    type: 'text-blocks-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['text-blocks-slide'].defaults),
      rows: structuredClone(ROWS),
    },
  };
}

/** The inspector form for `slide` with `selectedElement` selected. */
function renderInspector(slide, selectedElement) {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const noop = () => {};
  const deps = {
    pres: { id: 'p1', slides: [slide], settings: {} },
    user: {},
    markDirty: noop,
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
    getSelectedSlideId: () => slide.id,
    setSelectedSlideId: noop,
    editorState: {},
    requestSave: noop,
    rerenderSlideList: noop,
    rerenderPreview: noop,
    fieldRenderers: createFieldRenderers(deps),
    surface: 'inspector',
    getSelectedElement: () => selectedElement,
  }).rerender();
  return editorMount;
}

const elementForm = (mount) => mount.querySelector('.editor-element-form');
const activeTab = (mount) =>
  mount.querySelector('.inspector-tab.is-active')?.textContent.trim();
const labelsOf = (el) =>
  [...(el?.querySelectorAll('.field-label') || [])].map((l) =>
    l.textContent.trim(),
  );
/** The enum control labelled `label` (a segmented group or a select). */
const enumField = (el, label) =>
  [...el.querySelectorAll('.is-field')].find(
    (f) => f.querySelector('.field-label')?.textContent.trim() === label,
  );
// A segmented button or a dropdown, whichever the options fit (B457).
const pick = (field, value) => {
  const select = field.querySelector('select');
  if (select) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  field
    .querySelector(`[data-value="${value}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const picked = (field) =>
  field.querySelector('select')?.value ??
  field.querySelector('[aria-pressed="true"]')?.getAttribute('data-value');

test('a click on a row title selects the row and names the clicked text', () => {
  const slide = textBlocksSlide();
  const stage = document.createElement('div');
  const thumb = document.createElement('div');
  stage.append(thumb);
  document.body.append(stage);
  let selected = null;
  let editor;
  const rerenderPreview = () => {
    if (editor.isEditing()) return;
    thumb.innerHTML = '';
    thumb.append(
      renderSlideElement(slide, { mode: 'edit', lang: NO_DECK_LANG }),
    );
    editor.refresh();
  };
  editor = createInlineEditor({
    thumb,
    previewStage: stage,
    getSlide: () => slide,
    getSlideDef: (type) => SLIDE_TYPES[type],
    getCanEdit: () => true,
    markDirty: () => {},
    rerenderPreview,
    openImagePicker: () => {},
    pres: { id: 'p1', slides: [slide] },
    onSelectElement: (el) => {
      selected = el || null;
    },
    getSelectedElement: () => selected,
  });
  try {
    rerenderPreview();
    const title = thumb.querySelector('[data-inline-field="rows.1.title"]');
    assert.ok(title, 'the row title renders as an inline field');
    title.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    assert.deepEqual(selected, {
      kind: 'card',
      idx: 1,
      fieldKey: 'rows.1.title',
    });
  } finally {
    editor.detach();
    stage.remove();
  }
});

test('"This row" carries the colour and the arrow to the next row', () => {
  const slide = textBlocksSlide();
  const mount = renderInspector(slide, { kind: 'card', idx: 0 });
  assert.equal(activeTab(mount), 'This row');
  const form = elementForm(mount);
  assert.deepEqual(labelsOf(form), ['Color', 'Arrow after row']);
  assert.equal(picked(enumField(form, 'Color')), 'yellow');
  assert.equal(picked(enumField(form, 'Arrow after row')), 'down');

  pick(enumField(form, 'Arrow after row'), 'up');
  assert.equal(slide.content.rows[0].arrow, 'up', 'writes the row item');
  mount.remove();
});

test('the last row has no arrow: there is no next row to point at', () => {
  const mount = renderInspector(textBlocksSlide(), { kind: 'card', idx: 1 });
  assert.deepEqual(labelsOf(elementForm(mount)), ['Color']);
  mount.remove();
});

test("a row selected through its text also gets that text's tab", () => {
  const mount = renderInspector(textBlocksSlide(), {
    kind: 'card',
    idx: 0,
    fieldKey: 'rows.0.title',
  });
  const form = elementForm(mount);
  assert.deepEqual(labelsOf(form), ['Color', 'Arrow after row']);
  // A row title offers no text style (D220): the text part of the tab is the
  // sentence, not controls.
  assert.match(form.textContent, /follows the slide's layout/);
  mount.remove();
});

test('"This cell" carries a matrix cell\'s tone', () => {
  const slide = {
    id: 's1',
    type: 'matrix-slide',
    content: structuredClone(SLIDE_TYPES['matrix-slide'].defaults),
  };
  const mount = renderInspector(slide, { kind: 'card', idx: 2 });
  assert.equal(activeTab(mount), 'This cell');
  const tone = enumField(elementForm(mount), 'Tone');
  assert.ok(tone, 'the tone renders');
  pick(tone, 'negative');
  assert.equal(slide.content.cells[2].tone, 'negative');
  mount.remove();
});

test('an icon card renders its icon and link once, in the shared card', () => {
  const slide = {
    id: 's1',
    type: 'icon-card-grid-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['icon-card-grid-slide'].defaults),
      items: [
        { icon: 'star', title: 'A', body: '', link: '' },
        { icon: 'heart', title: 'B', body: '', link: '' },
      ],
    },
  };
  const mount = renderInspector(slide, { kind: 'card', idx: 1 });
  assert.equal(activeTab(mount), 'This card');
  const form = elementForm(mount);
  const labels = [...form.querySelectorAll('.field-label, label')].map((el) =>
    el.textContent.trim(),
  );
  assert.equal(
    labels.filter((l) => l === 'Icon').length,
    1,
    `one icon picker (labels: ${labels.join(', ')})`,
  );
  // The all-cards overview is for the no-selection view only.
  assert.equal(mount.textContent.includes('Card icons & links'), false);
  mount.remove();
});

test('a logo\'s name and link are in "This image"', () => {
  const slide = {
    id: 's1',
    type: 'logo-wall-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['logo-wall-slide'].defaults),
      logos: [
        { image: 'https://example.com/a.png', name: 'Acme', alt: '', link: '' },
      ],
    },
  };
  const mount = renderInspector(slide, { kind: 'image', idx: 0 });
  const form = elementForm(mount);
  const values = [...form.querySelectorAll('input')].map((el) => el.value);
  assert.ok(values.includes('Acme'), `name renders (values: ${values})`);
  const labels = [...form.querySelectorAll('.field-label, label')].map((el) =>
    el.textContent.trim().toLowerCase(),
  );
  assert.ok(
    labels.some((l) => l.includes('link')),
    `link renders (labels: ${labels.join(', ')})`,
  );
  mount.remove();
});

/*
 * The "This text" tab shows what the type offers, and nothing else (B464,
 * D220): a standalone offer, a shared offer over array items, or the sentence.
 * No field shows a colour control (D221).
 */

const textSlide = (type, content) => ({
  id: 's1',
  type,
  content: { ...structuredClone(SLIDE_TYPES[type].defaults), ...content },
});

test('"This text" on an offering field shows its offer and no colour', () => {
  const slide = textSlide('content-slide', {});
  const mount = renderInspector(slide, { kind: 'text', fieldKey: 'body' });
  const form = elementForm(mount);
  assert.deepEqual(labelsOf(form), ['Alignment', 'Text size']);
  pick(enumField(form, 'Text size'), 'lg');
  assert.deepEqual(slide.content.textStyles, { body: { size: 'lg' } });
  mount.remove();
});

test('"This text" on Image blocks is the sentence, not controls', () => {
  const slide = textSlide('team-cards-slide', {});
  const mount = renderInspector(slide, {
    kind: 'text',
    fieldKey: 'members.0.name',
  });
  const form = elementForm(mount);
  assert.deepEqual(labelsOf(form), []);
  assert.match(form.textContent, /follows the slide's layout/);
  mount.remove();
});

test('"This text" on one quote styles every quote under one key', () => {
  const slide = textSlide('quote-slide', {
    quotes: [{ quote: 'One.' }, { quote: 'Two.' }],
  });
  const mount = renderInspector(slide, {
    kind: 'text',
    fieldKey: 'quotes.1.quote',
  });
  const form = elementForm(mount);
  // Alignment is the quote block's, shown disabled with a pointer to Layout.
  assert.deepEqual(labelsOf(form), [
    'All "Quote" (2)',
    'Alignment',
    'Text size',
  ]);
  assert.ok(enumField(form, 'Alignment').classList.contains('is-disabled'));
  pick(enumField(form, 'Text size'), 'sm');
  assert.deepEqual(slide.content.textStyles, {
    'quotes.*.quote': { size: 'sm' },
  });
  mount.remove();
});
