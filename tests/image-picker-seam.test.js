/**
 * The image-picker seam (client/views/editor/media/picker-provider.js).
 *
 * One `openImagePicker` over a provider table is the whole point: a call site
 * must never learn which source backs it, and a source must never appear in
 * the chooser unless its opener was injected. This covers the arithmetic that
 * decides that — zero providers is a no-op, one opens directly, more than one
 * shows the chooser — because a third provider (bundled gradients) landed on
 * a seam that had no test at all.
 *
 * Run with: node --test tests/image-picker-seam.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
// jsdom ships no rAF; the modal's focus trap defers its first focus through it.
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { createImagePickerSeam } =
  await import('../client/views/editor/media/picker-provider.js');

const noop = () => {};

/** @returns {{ open: Function, calls: Object[] }} a raw opener that records its opts. */
function spyOpener() {
  const calls = [];
  const open = (opts) => calls.push(opts);
  return { open, calls };
}

test('no injected opener means no provider and no modal', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({ root, features: {} });
  assert.deepEqual(seam.providers, []);
  seam({ onPick: noop });
  assert.equal(root.querySelector('.image-source-chooser'), null);
});

test('a single provider opens directly, without a chooser', () => {
  const root = document.createElement('div');
  const lib = spyOpener();
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: true },
    openImageLibrary: lib.open,
  });
  assert.deepEqual(
    seam.providers.map((p) => p.id),
    ['local-library'],
  );
  seam({ title: 'Pick', onPick: noop });
  assert.equal(lib.calls.length, 1);
  assert.equal(lib.calls[0].title, 'Pick');
  assert.equal(root.querySelector('.image-source-chooser'), null);
});

test('bundled gradients register as a third source when their opener is injected', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: true, imagekitConfigured: true },
    openImageLibrary: spyOpener().open,
    openBundledGradients: spyOpener().open,
    openImageKit: spyOpener().open,
  });
  assert.deepEqual(
    seam.providers.map((p) => p.id),
    // ImageKit is primary, so it leads; the others keep their declared order.
    ['imagekit', 'local-library', 'bundled'],
  );
});

test('without an injected opener the bundled source is absent, not merely hidden', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: true },
    openImageLibrary: spyOpener().open,
  });
  assert.equal(
    seam.providers.some((p) => p.id === 'bundled'),
    false,
  );
});

test('enableImageLibrary: false drops the library but keeps the other sources', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: false },
    openImageLibrary: spyOpener().open,
    openBundledGradients: spyOpener().open,
  });
  assert.deepEqual(
    seam.providers.map((p) => p.id),
    ['bundled'],
  );
});

test('more than one provider shows a chooser, and choosing opens that source', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const lib = spyOpener();
  const bundled = spyOpener();
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: true },
    openImageLibrary: lib.open,
    openBundledGradients: bundled.open,
  });

  seam({ title: 'Pick', onPick: noop });
  const chooser = document.querySelector('.image-source-chooser');
  assert.ok(chooser, 'expected a source chooser');
  const buttons = [...chooser.querySelectorAll('.image-source-list button')];
  assert.equal(buttons.length, 2);
  assert.equal(lib.calls.length, 0);
  assert.equal(bundled.calls.length, 0);

  buttons[1].click();
  assert.equal(bundled.calls.length, 1);
  assert.equal(lib.calls.length, 0);
  root.remove();
});

test("the gradient picker keeps its own heading, not the field's", () => {
  const root = document.createElement('div');
  const lib = spyOpener();
  const bundled = spyOpener();
  createImagePickerSeam({
    root,
    features: { enableImageLibrary: true },
    openImageLibrary: lib.open,
  })({
    title: 'Library: choose an image',
    onPick: noop,
  });
  // The library is named by the field it was opened from…
  assert.equal(lib.calls[0].title, 'Library: choose an image');

  createImagePickerSeam({ root, openBundledGradients: bundled.open })({
    title: 'Library: choose an image',
    onPick: noop,
  });
  // …the gradient picker is not: once a source is chosen, the heading names
  // the source. Forwarding put "Library: choose an image" above the gradients.
  assert.equal(bundled.calls[0].title, undefined);
});

test('the bundled adapter forwards its pick untouched — the manifest is already normalized', () => {
  const root = document.createElement('div');
  let opened = null;
  const seam = createImagePickerSeam({
    root,
    openBundledGradients: (opts) => {
      opened = opts;
    },
  });

  const picked = [];
  seam({ onPick: (p) => picked.push(p) });
  opened.onPick({
    url: '/assets/gradients/brand-aurora.svg',
    alt: 'Abstract aurora gradient in the Forest palette',
    tags: ['gradient', 'aurora'],
    meta: { source: 'bundled-gradient' },
  });

  assert.equal(picked.length, 1);
  assert.equal(picked[0].url, '/assets/gradients/brand-aurora.svg');
  assert.equal(picked[0].meta.source, 'bundled-gradient');
});

/** Resolve after the chooser's focus frame (rAF is a 0 ms timeout here). */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 5));

/** @returns {HTMLElement} a root attached to the document, so focus works. */
function attachedRoot() {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

/** @returns {{ id: string, primary: boolean, label: string, description: string }[]} */
function cardsOf(chooser) {
  return [...chooser.querySelectorAll('.image-source-card')].map((b) => ({
    id: b.dataset.sourceId,
    primary: b.classList.contains('btn-primary'),
    label: b.querySelector('.image-source-card-label')?.textContent,
    description: b.querySelector('.image-source-card-description')?.textContent,
  }));
}

test('a configured ImageKit is primary and ordered first; the rest keep their order', () => {
  const seam = createImagePickerSeam({
    root: document.createElement('div'),
    features: { enableImageLibrary: true },
    openImageLibrary: spyOpener().open,
    openBundledGradients: spyOpener().open,
    openImageKit: spyOpener().open,
  });
  assert.deepEqual(
    seam.providers.map((p) => [p.id, p.primary === true]),
    [
      ['imagekit', true],
      ['local-library', false],
      ['bundled', false],
    ],
  );
  for (const p of seam.providers) {
    assert.equal(typeof p.description, 'string', `${p.id} has a description`);
    assert.ok(p.description.length > 0);
  }
});

test('library + ImageKit: two cards with a description, ImageKit on top, primary and focused', async () => {
  const root = attachedRoot();
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: true },
    openImageLibrary: spyOpener().open,
    openImageKit: spyOpener().open,
  });
  seam({ onPick: noop });
  const chooser = root.querySelector('.image-source-chooser');
  const cards = cardsOf(chooser);
  assert.deepEqual(
    cards.map((c) => [c.id, c.primary]),
    [
      ['imagekit', true],
      ['local-library', false],
    ],
  );
  assert.ok(cards.every((c) => c.description));
  const buttons = chooser.querySelectorAll('.image-source-card');
  assert.ok(buttons[0].classList.contains('btn-primary'));
  assert.ok(buttons[1].classList.contains('btn-secondary'));
  await nextFrame();
  assert.equal(document.activeElement, buttons[0]);
  root.remove();
});

test('a fork sets label, description and primary on the providers without patching the chooser', async () => {
  const root = attachedRoot();
  const lib = spyOpener();
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: true },
    openImageLibrary: lib.open,
    openBundledGradients: spyOpener().open,
    openImageKit: spyOpener().open,
  });
  // What a fork's image-pickers.js does after building the seam.
  const dam = seam.providers.find((p) => p.id === 'imagekit');
  dam.label = 'CIIIC Beeldbank';
  dam.description = "Alle foto's van CIIIC-events, portretten en logo's";
  dam.primary = false;
  const library = seam.providers.find((p) => p.id === 'local-library');
  library.primary = true;

  seam({ onPick: noop });
  const chooser = root.querySelector('.image-source-chooser');
  assert.deepEqual(cardsOf(chooser), [
    {
      id: 'local-library',
      primary: true,
      label: library.label,
      description: library.description,
    },
    {
      id: 'imagekit',
      primary: false,
      label: 'CIIIC Beeldbank',
      description: "Alle foto's van CIIIC-events, portretten en logo's",
    },
    {
      id: 'bundled',
      primary: false,
      label: seam.providers[2].label,
      description: seam.providers[2].description,
    },
  ]);
  await nextFrame();
  const first = chooser.querySelector('.image-source-card');
  assert.equal(document.activeElement, first);
  first.click();
  assert.equal(lib.calls.length, 1);
  root.remove();
});

test('two primary sources are refused, not silently ordered', () => {
  const root = attachedRoot();
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: true },
    openImageLibrary: spyOpener().open,
    openImageKit: spyOpener().open,
  });
  seam.providers.find((p) => p.id === 'local-library').primary = true;
  assert.throws(() => seam({ onPick: noop }), /at most one primary source/);
  assert.equal(root.querySelector('.image-source-chooser'), null);
  root.remove();
});

test("a call site's hint is shown under the chooser title, and only when given", () => {
  const root = attachedRoot();
  const seam = createImagePickerSeam({
    root,
    features: { enableImageLibrary: true },
    openImageLibrary: spyOpener().open,
    openBundledGradients: spyOpener().open,
  });
  seam({ hint: 'For the background of this slide', onPick: noop });
  assert.equal(
    root.querySelector('.image-source-chooser .image-source-hint')?.textContent,
    'For the background of this slide',
  );
  root.replaceChildren();
  seam({ onPick: noop });
  assert.equal(root.querySelector('.image-source-hint'), null);
  root.remove();
});
