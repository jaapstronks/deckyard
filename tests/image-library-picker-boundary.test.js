import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const name of [
  'window',
  'document',
  'HTMLElement',
  'Node',
  'Element',
  'FileReader',
]) {
  globalThis[name] = name === 'window' ? dom.window : dom.window[name];
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.URL.createObjectURL = () => 'blob:picker-test';
globalThis.URL.revokeObjectURL = () => {};
const { openImageLibraryPicker } =
  await import('../client/views/editor/image-library/picker.js');
const { closeAllOverlays } = await import('../client/lib/dom/modal.js');
const { setFeatures } = await import('../client/lib/state/features.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const files = () =>
  ['first.txt', 'second.txt'].map(
    (name) => new dom.window.File(['text'], name, { type: 'text/plain' }),
  );

function dropFiles() {
  const event = new dom.window.Event('drop', {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'dataTransfer', { value: { files: files() } });
  document.querySelector('.image-lib-dropzone').dispatchEvent(event);
}

test.afterEach(() => {
  closeAllOverlays(document);
  document.body.replaceChildren();
  setFeatures(null);
});

for (const single of [false, true]) {
  test(`${single ? 'single destination' : 'library management'} keeps its batch upload boundary`, async () => {
    setFeatures({ enableUploads: true, enableStockMedia: false });
    openImageLibraryPicker({
      root: document.body,
      api: async () => ({ items: [] }),
      user: { email: 'test@example.com' },
      ...(single
        ? { onPick: () => assert.fail('invalid files cannot be picked') }
        : {}),
    });
    await tick();
    assert.equal(
      !!document.querySelector('.image-batch-library-entry'),
      !single,
    );
    dropFiles();
    await tick();
    assert.equal(!!document.querySelector('.image-batch-modal'), !single);
    if (!single)
      assert.equal(document.querySelectorAll('.image-batch-row').length, 2);
  });
}

test('explicit collection batch entry still opens a multiple file chooser', () => {
  const clicked = [];
  const original = dom.window.HTMLInputElement.prototype.click;
  dom.window.HTMLInputElement.prototype.click = function () {
    clicked.push(this);
  };
  try {
    openImageLibraryPicker({ batch: true, onPickMany: () => {} });
    assert.equal(clicked.length, 1);
    assert.equal(clicked[0].type, 'file');
    assert.equal(clicked[0].multiple, true);
    assert.equal(document.querySelector('.image-library-modal'), null);
  } finally {
    dom.window.HTMLInputElement.prototype.click = original;
  }
});
