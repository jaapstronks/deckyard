/**
 * The default of a choice control is visible, and "Back to default" appears
 * only on a deviation (D346, B722).
 *
 * The default option carries a dot with the tooltip "Default"; while the
 * value deviates a "Back to default" button sits under the control, and its
 * click is the same act as choosing the default: a text style entry is
 * pruned from `content.textStyles`, the background is pruned (the render
 * pipeline fills an empty one with the type's standard, B733), another
 * content enum gets the type default back, a fit with a type default is
 * emptied, the focus returns to the centre.
 *
 * Run with: node --test tests/default-mark.test.js
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
globalThis.history = dom.window.history;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;

const { createFieldRenderers } =
  await import('../client/views/editor/fields/index.js');
const { createRenderField } =
  await import('../client/views/editor/editor-form/render-field.js');
const { renderTextElementCard } =
  await import('../client/views/editor/editor-form/text-element-card.js');
const { renderImageFitField } =
  await import('../client/views/editor/fields/image-fit.js');
const { renderFocusGridField } =
  await import('../client/views/editor/editor-form/focus-picker.js');
const { getSlideType } = await import('../shared/slide-types/registry.js');

/** The reset buttons in `el`, and whether one is showing. */
const resets = (el) => [...el.querySelectorAll('.field-reset-default')];
const resetShown = (el) => resets(el).some((b) => !b.hidden);
const segment = (el, v) => el.querySelector(`button[data-value="${v}"]`);

/** The "This text" card for the body of a content slide. */
function textCard(content) {
  const slide = { id: 's', type: 'content-slide', content };
  const container = document.createElement('div');
  renderTextElementCard({
    container,
    slide,
    fieldKey: 'body',
    fieldRenderers: createFieldRenderers({}),
    markDirty: () => {},
  });
  return { slide, container };
}

/** One schema field of a real slide type, through the inspector renderer. */
function schemaField(type, key, content, { theme = null } = {}) {
  const def = getSlideType(type);
  const slide = { id: 's', type, content: { ...content } };
  const renderField = createRenderField({
    pres: { slides: [slide] },
    slide,
    def,
    theme,
    fieldRenderers: createFieldRenderers({ theme }),
    markDirty: () => {},
  });
  const field = def.fields.find((f) => f.key === key);
  return { slide, def, el: renderField(field) };
}

test('the default text size is marked, and no reset shows without a deviation', () => {
  const { container } = textCard({ title: 'T', body: 'Intro' });
  const md = segment(container, 'md');
  assert.ok(md.classList.contains('is-default'));
  assert.match(md.title, /\(Default\)$/);
  assert.equal(
    md.querySelector('.field-default-dot')?.getAttribute('aria-hidden'),
    'true',
  );
  assert.match(md.getAttribute('aria-label'), /\(Default\)$/);
  assert.ok(!segment(container, 'lg').classList.contains('is-default'));
  assert.equal(resetShown(container), false);
});

test('"Back to default" on a deviating text size prunes the textStyles entry', () => {
  const { slide, container } = textCard({
    title: 'T',
    body: 'Intro',
    textStyles: { body: { size: 'lg' } },
  });
  const shown = resets(container).filter((b) => !b.hidden);
  assert.equal(shown.length, 1, 'only the deviating control offers a reset');
  assert.equal(shown[0].textContent, 'Back to default');
  shown[0].click();
  assert.equal(slide.content.textStyles, undefined);
  assert.equal(resetShown(container), false);
  assert.ok(segment(container, 'md').classList.contains('is-active'));
});

test('choosing a non-default value brings the reset; choosing the default hides it', () => {
  const { slide, container } = textCard({ title: 'T', body: 'Intro' });
  segment(container, 'sm').click();
  assert.deepEqual(slide.content.textStyles, { body: { size: 'sm' } });
  assert.equal(resetShown(container), true);
  segment(container, 'md').click();
  assert.equal(slide.content.textStyles, undefined);
  assert.equal(resetShown(container), false);
});

test('the background colour marks the type default and resets to it', () => {
  const { slide, def, el } = schemaField('callout-slide', 'background', {
    background: 'lime',
  });
  assert.equal(def.defaults.background, 'mist');
  const rows = [...el.querySelectorAll('.bg-picker-option')];
  const marked = rows.filter((r) => r.querySelector('.field-default-dot'));
  assert.equal(marked.length, 1);
  assert.match(marked[0].title, /\(Default\)$/);
  assert.equal(resetShown(el), true);
  resets(el)[0].click();
  // Pruned, not written back: an empty background renders the type's own
  // standard (B733), so a later change to that standard reaches this slide.
  assert.equal('background' in slide.content, false);
  assert.equal(resetShown(el), false);
});

test('a background on its default shows no reset and the default as current', () => {
  const { el } = schemaField('callout-slide', 'background', {});
  assert.equal(resetShown(el), false);
  const active = el.querySelector('.bg-picker-option.is-active');
  assert.ok(active.querySelector('.field-default-dot'));
});

test('an explicit background is stored; choosing the standard prunes it', () => {
  const { slide, el } = schemaField('pyramid-slide', 'background', {});
  const pick = (label) =>
    [...el.querySelectorAll('.bg-picker-option')]
      .find((b) => b.textContent.includes(label))
      .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  pick('Color 1');
  assert.equal(slide.content.background, 'lime');
  pick('Color 2');
  assert.equal('background' in slide.content, false);
});

test("the theme's ground is the marked standard under that theme", () => {
  // content-slide defaults to lime; a mist-ground theme makes mist the
  // standard, the same value the renderer fills an empty background with.
  const { slide, el } = schemaField(
    'content-slide',
    'background',
    { background: 'lime' },
    { theme: { defaultBackground: 'mist' } },
  );
  const marked = el.querySelector('.bg-picker-option .field-default-dot');
  assert.match(marked.parentElement.textContent, /Color 2/);
  resets(el)[0].click();
  assert.equal('background' in slide.content, false);
});

test('the image background marks its default and resets to it', () => {
  const { slide, el } = schemaField('image-text-slide', 'imageBackground', {
    imageBackground: 'match',
  });
  assert.ok(segment(el, 'white').classList.contains('is-default'));
  assert.equal(resetShown(el), true);
  resets(el)[0].click();
  assert.equal(slide.content.imageBackground, 'white');
  assert.equal(resetShown(el), false);
});

test('a fit with a type default marks it instead of a third "Default" option', () => {
  const stored = [];
  const target = { fit: 'contain' };
  const el = renderImageFitField({
    fieldEnum: createFieldRenderers({}).fieldEnum,
    field: { key: 'fit' },
    target,
    typeDefault: 'cover',
    onChange: (v) => stored.push(v),
  });
  assert.deepEqual(
    [...el.querySelectorAll('button[data-value]')].map((b) => b.dataset.value),
    ['cover', 'contain'],
  );
  assert.ok(segment(el, 'cover').classList.contains('is-default'));
  assert.ok(segment(el, 'contain').classList.contains('is-active'));
  resets(el)[0].click();
  segment(el, 'contain').click();
  segment(el, 'cover').click();
  // The default empties the field; only a deviation is written.
  assert.deepEqual(stored, ['', 'contain', '']);
});

test('an empty fit shows the type default as the active, marked option', () => {
  const el = renderImageFitField({
    fieldEnum: createFieldRenderers({}).fieldEnum,
    field: { key: 'fit' },
    target: {},
    typeDefault: 'contain',
    onChange: () => {},
  });
  const contain = segment(el, 'contain');
  assert.ok(contain.classList.contains('is-active'));
  assert.ok(contain.classList.contains('is-default'));
  assert.equal(resetShown(el), false);
});

test('a fit without a type default carries no mark', () => {
  const el = renderImageFitField({
    fieldEnum: createFieldRenderers({}).fieldEnum,
    field: { key: 'fit' },
    target: { fit: 'contain' },
    typeDefault: '',
    onChange: () => {},
  });
  assert.equal(el.querySelector('.is-default'), null);
  assert.equal(resets(el).length, 0);
});

test('the focus grid marks the centre and resets to it only off-centre', () => {
  const calls = [];
  const el = renderFocusGridField({
    focusX: 0,
    focusY: 0,
    onChange: (v) => calls.push(v),
  });
  const centre = el.querySelector('.sb-focus-btn[data-x="50"][data-y="50"]');
  assert.ok(centre.classList.contains('is-default'));
  assert.match(centre.title, /\(Default\)$/);
  assert.equal(resetShown(el), true);
  resets(el)[0].click();
  assert.deepEqual(calls, [{ focusX: 50, focusY: 50 }]);
  assert.equal(resetShown(el), false);
  assert.ok(centre.classList.contains('is-active'));

  const atCentre = renderFocusGridField({ focusX: 50, focusY: 50 });
  assert.equal(resetShown(atCentre), false);
});
