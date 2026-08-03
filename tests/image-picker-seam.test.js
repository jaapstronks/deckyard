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

const { h } = await import('../client/lib/dom.js');
const { createImagePickerSeam } = await import(
  '../client/views/editor/media/picker-provider.js'
);

const noop = () => {};

/** @returns {{ open: Function, calls: Object[] }} a raw opener that records its opts. */
function spyOpener() {
  const calls = [];
  const open = (opts) => calls.push(opts);
  return { open, calls };
}

test('no injected opener means no provider and no modal', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({ h, root, features: {} });
  assert.deepEqual(seam.providers, []);
  seam({ onPick: noop });
  assert.equal(root.querySelector('.image-source-chooser'), null);
});

test('a single provider opens directly, without a chooser', () => {
  const root = document.createElement('div');
  const lib = spyOpener();
  const seam = createImagePickerSeam({ h, root, openImageLibrary: lib.open });
  assert.deepEqual(
    seam.providers.map((p) => p.id),
    ['local-library']
  );
  seam({ title: 'Pick', onPick: noop });
  assert.equal(lib.calls.length, 1);
  assert.equal(lib.calls[0].title, 'Pick');
  assert.equal(root.querySelector('.image-source-chooser'), null);
});

test('bundled gradients register as a third source when their opener is injected', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({
    h,
    root,
    features: { imagekitConfigured: true },
    openImageLibrary: spyOpener().open,
    openBundledGradients: spyOpener().open,
    openImageKit: spyOpener().open,
  });
  assert.deepEqual(
    seam.providers.map((p) => p.id),
    ['local-library', 'bundled', 'imagekit']
  );
});

test('without an injected opener the bundled source is absent, not merely hidden', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({ h, root, openImageLibrary: spyOpener().open });
  assert.equal(
    seam.providers.some((p) => p.id === 'bundled'),
    false
  );
});

test('disableImageLibrary drops the library but keeps the other sources', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({
    h,
    root,
    features: { disableImageLibrary: true },
    openImageLibrary: spyOpener().open,
    openBundledGradients: spyOpener().open,
  });
  assert.deepEqual(
    seam.providers.map((p) => p.id),
    ['bundled']
  );
});

test('more than one provider shows a chooser, and choosing opens that source', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const lib = spyOpener();
  const bundled = spyOpener();
  const seam = createImagePickerSeam({
    h,
    root,
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

test('the gradient picker keeps its own heading, not the field\'s', () => {
  const root = document.createElement('div');
  const lib = spyOpener();
  const bundled = spyOpener();
  createImagePickerSeam({ h, root, openImageLibrary: lib.open })({
    title: 'Library: choose an image',
    onPick: noop,
  });
  // The library is named by the field it was opened from…
  assert.equal(lib.calls[0].title, 'Library: choose an image');

  createImagePickerSeam({ h, root, openBundledGradients: bundled.open })({
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
    h,
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
