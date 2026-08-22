/**
 * Step 5 of the editor-behaviour-abstraction brief, end to end: image-slide
 * and image-text-slide no longer have hand-built side forms. What the two
 * forms used to do imperatively is now declared — `editor: 'image-fit'` for
 * the fit control with its derived default option, `visibleWhen` for the
 * alt-on-role and zoom chains, `hidden: true` for the ImageRef keys the
 * element surfaces own, `formLayout: 'pair'` for the side-by-side rows — and
 * the generic loop renders it on both surfaces.
 *
 * Run with: node --test tests/image-editor-vocabulary.test.js
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
globalThis.Image = dom.window.Image;
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

const { createFieldRenderers } =
  await import('../client/views/editor/fields.js');
const { createRerenderEditor } =
  await import('../client/views/editor/editor-form.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { normalizeSlideContent } =
  await import('../shared/slide-types/normalize-content.js');
const { FIELD_EDITOR_VALUES, fieldEditor } =
  await import('../shared/slide-types/field-editors.js');

function renderForm({ type, content, contentOnly = true } = {}) {
  const editorMount = document.createElement('div');
  document.body.append(editorMount);
  const slide = {
    id: 's1',
    type,
    content: content || structuredClone(SLIDE_TYPES[type]?.defaults || {}),
  };
  const pres = { id: 'p1', slides: [slide], settings: {} };
  const noop = () => {};
  const deps = {
    pres,
    user: {},
    markDirty: noop,
    scheduleUiRefresh: noop,
    rerenderEditor: noop,
    updateSelectedSlideListItem: noop,
    normalizeLang: (l) => l,
  };
  const rerender = createRerenderEditor({
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
    contentOnly,
  }).rerender;
  rerender();
  return { editorMount, slide };
}

const labelsOf = (root) =>
  Array.from(root.querySelectorAll('label, .field-label')).map((el) =>
    el.textContent.trim(),
  );

/** The field wrapper for a content key (every one carries its collab key). */
const fieldFor = (root, key) =>
  root.querySelector(`[data-collab-field-key="${key}"]`);

/** Every option label of the control for `key`, or null when it doesn't render. */
function optionsFor(root, key) {
  const field = fieldFor(root, key);
  if (!field) return null;
  const nodes = field.querySelectorAll('option, .sb-segmented-btn');
  return Array.from(nodes).map((el) => el.textContent.trim());
}

/** Choose `optionText` on the control for `key`. */
function chooseOption(root, key, optionText) {
  const field = fieldFor(root, key);
  assert.ok(field, `control "${key}" renders`);
  const btn = Array.from(field.querySelectorAll('.sb-segmented-btn')).find(
    (el) => el.textContent.trim().toLowerCase() === optionText.toLowerCase(),
  );
  if (btn) {
    btn.click();
    return;
  }
  const select = field.querySelector('select');
  assert.ok(select, `control "${key}" has a choosable option`);
  const opt = Array.from(select.options).find(
    (o) => o.textContent.trim().toLowerCase() === optionText.toLowerCase(),
  );
  assert.ok(opt, `option "${optionText}" exists`);
  select.value = opt.value;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

test('image-fit is in the closed vocabulary and both image types declare it', () => {
  assert.ok(FIELD_EDITOR_VALUES.includes('image-fit'));
  const slideFit = SLIDE_TYPES['image-slide'].fields.find(
    (f) => f.key === 'fit',
  );
  assert.equal(fieldEditor(slideFit), 'image-fit');
  const images = SLIDE_TYPES['image-text-slide'].fields.find(
    (f) => f.key === 'images',
  );
  const itemFit = images.itemFields.find((f) => f.key === 'fit');
  assert.equal(fieldEditor(itemFit), 'image-fit');
});

test('image-slide: the fit control offers the default derived from imageDefaults', () => {
  const { editorMount } = renderForm({ type: 'image-slide' });
  const options = optionsFor(editorMount, 'fit');
  assert.ok(options, 'fit control renders');
  // imageDefaults.fit is 'cover', so the empty option names Fill (crop).
  assert.ok(
    options.some((o) => o.startsWith('Default') && o.includes('Fill')),
    `derived default option, got ${JSON.stringify(options)}`,
  );
  assert.ok(
    options.some((o) => o.includes('Fit (no crop)')),
    'contain option',
  );
});

test('image-slide: fit and bleed share one declared row', () => {
  const { editorMount } = renderForm({ type: 'image-slide' });
  const grid = Array.from(editorMount.querySelectorAll('.field-grid')).find(
    (g) => labelsOf(g).some((l) => l.includes('Image fit')),
  );
  assert.ok(grid, 'fit renders inside a field-grid row');
  assert.ok(
    labelsOf(grid).some((l) => l.includes('Edge-to-edge')),
    'bleed shares the row',
  );
});

test('boolean fields store only the deviating value (bleed)', () => {
  const { editorMount, slide } = renderForm({ type: 'image-slide' });
  chooseOption(editorMount, 'bleed', 'On');
  assert.equal(slide.content.bleed, true, 'On is written');
  chooseOption(editorMount, 'bleed', 'Off');
  assert.equal(
    slide.content.bleed,
    '',
    'Off clears, so the type default stays looked up',
  );
});

test('image-slide: alt is declared away for a decorative image', () => {
  const meaningful = renderForm({
    type: 'image-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['image-slide'].defaults),
      imageRole: 'content',
    },
  });
  assert.ok(
    labelsOf(meaningful.editorMount).some((l) => l.includes('Alt text')),
    'alt renders for a meaningful image',
  );
  const decorative = renderForm({
    type: 'image-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['image-slide'].defaults),
      imageRole: 'decorative',
    },
  });
  assert.ok(
    !labelsOf(decorative.editorMount).some((l) => l.includes('Alt text')),
    'alt is hidden for a decorative image',
  );
});

test('image-slide: the zoom chain is a visibleWhen chain', () => {
  const base = structuredClone(SLIDE_TYPES['image-slide'].defaults);
  const off = renderForm({
    type: 'image-slide',
    content: { ...base, zoomSteps: '' },
  });
  const offLabels = labelsOf(off.editorMount);
  assert.ok(
    !offLabels.some((l) => l.includes('Zoom level')),
    'no zoom level while zoom is off',
  );
  assert.ok(
    !offLabels.some((l) => l.includes('Custom zoom')),
    'no positions while zoom is off',
  );

  const corners = renderForm({
    type: 'image-slide',
    content: { ...base, zoomSteps: 'corners' },
  });
  const cornerLabels = labelsOf(corners.editorMount);
  assert.ok(
    cornerLabels.some((l) => l.includes('Zoom level')),
    'zoom level once zoom is on',
  );
  assert.ok(
    !cornerLabels.some((l) => l.includes('Custom zoom')),
    'positions stay custom-only',
  );

  const custom = renderForm({
    type: 'image-slide',
    content: { ...base, zoomSteps: 'custom' },
  });
  assert.ok(
    labelsOf(custom.editorMount).some((l) => l.includes('Custom zoom')),
    'positions appear on custom',
  );
});

test('image-slide: the ImageRef keys the element surfaces own never render as fields', () => {
  const { editorMount } = renderForm({ type: 'image-slide' });
  const labels = labelsOf(editorMount);
  for (const dead of ['Focus X', 'Focus Y', 'Layout']) {
    assert.ok(
      !labels.some((l) => l === dead),
      `${dead} is carried data, not a control`,
    );
  }
});

test('image-text: images render through the generic collection editor', () => {
  const { editorMount } = renderForm({
    type: 'image-text-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['image-text-slide'].defaults),
      layout: 'duo',
      images: [
        { src: '/uploads/a.jpg', alt: 'a' },
        { src: '/uploads/b.jpg', alt: 'b' },
      ],
    },
  });
  const collection = editorMount.querySelector('.collection-editor');
  assert.ok(collection, 'one generic collection editor');
  // Item widgets are inside the collection editor's own item loop, so they
  // carry no collab field key — find them by the control's accessible name.
  const fitControls = collection.querySelectorAll(
    '.sb-segmented[aria-label="Image fit"]',
  );
  assert.equal(fitControls.length, 2, 'one fit control per image item');
  const options = Array.from(
    fitControls[0].querySelectorAll('.sb-segmented-btn'),
  ).map((el) => el.textContent.trim());
  assert.ok(
    options.some((o) => o.startsWith('Default') && o.includes('Fill')),
    `the item widget also carries the derived default, got ${JSON.stringify(options)}`,
  );
  const labels = labelsOf(editorMount);
  assert.ok(
    !labels.some((l) => l === 'Focus X'),
    'per-item focus stays element-owned',
  );
});

test('normalizeContent folds the legacy layout enum when the editor opens', () => {
  const { slide } = renderForm({
    type: 'image-slide',
    content: {
      ...structuredClone(SLIDE_TYPES['image-slide'].defaults),
      layout: 'centered',
    },
  });
  assert.equal(slide.content.fit, 'contain', 'centered became the contain fit');
  assert.equal(slide.content.layout, '', 'the legacy enum is cleared');
});

test('normalizeSlideContent degrades instead of breaking the editor', () => {
  assert.doesNotThrow(() => normalizeSlideContent('nope', undefined, { a: 1 }));
  assert.doesNotThrow(() => normalizeSlideContent('image-slide', {}, null));
  const thrower = {
    normalizeContent: () => {
      throw new Error('boom');
    },
  };
  const content = { a: 1 };
  assert.equal(
    normalizeSlideContent('x', thrower, content),
    content,
    'a throwing hook is swallowed',
  );
});

test('the hook is found on the bundled registry when the def cannot carry it', () => {
  // What the editor actually holds is the /api/slide-types response: JSON, so
  // no functions. Resolution has to fall back to the registry or the migration
  // silently stops running in the real app (which is how it was caught).
  const wireDef = JSON.parse(JSON.stringify(SLIDE_TYPES['image-slide']));
  assert.equal(
    wireDef.normalizeContent,
    undefined,
    'a function cannot survive JSON',
  );
  const content = { layout: 'centered' };
  normalizeSlideContent('image-slide', wireDef, content);
  assert.equal(content.fit, 'contain', 'the registry hook still ran');
  assert.equal(content.layout, '');
});

test('imageDefaults travels on the /api/slide-types projection', async () => {
  // The widget's derived default label reads def.imageDefaults.fit, and the
  // editor holds the wire response, not the registry.
  const { handleSlideTypes } =
    await import('../server/routes/api/slide-types.js');
  let payload = null;
  const res = {
    setHeader() {},
    writeHead() {},
    end(body) {
      payload = JSON.parse(body);
    },
  };
  await handleSlideTypes({
    req: { method: 'GET' },
    res,
    url: new URL('http://x/api/slide-types'),
    authedUser: null,
  });
  assert.equal(payload['image-slide'].imageDefaults.fit, 'cover');
  assert.equal(payload['image-slide'].imageDefaults.bleed, false);
});
