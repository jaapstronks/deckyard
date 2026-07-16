/**
 * Editor loading skeleton + duplicate-fetch elimination.
 *
 * - showEditorLoadingSkeleton mounts the real layout classes (so the
 *   editor-layout CSS applies) and is idempotent; the returned remover and
 *   hideEditorLoadingSkeleton both clear it.
 * - loadEditorModel accepts the route handler's already-fetched presentation
 *   via initialPres and must not fetch it a second time.
 *
 * Run with: node --test tests/editor-loading-skeleton.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;

const { showEditorLoadingSkeleton, hideEditorLoadingSkeleton } = await import(
  '../client/views/editor/loading-skeleton.js'
);
const { loadEditorModel } = await import(
  '../client/views/editor/load-editor-model.js'
);

test('skeleton mounts the editor layout classes and removes cleanly', () => {
  const root = document.getElementById('app');

  const hide = showEditorLoadingSkeleton(root);
  const shell = root.querySelector('.editor-loading-skeleton');
  assert.ok(shell, 'skeleton shell mounted');
  assert.ok(shell.classList.contains('editor-shell'), 'reuses editor-shell');
  assert.ok(shell.querySelector('.layout'), 'has .layout');
  for (const cls of ['slides-panel', 'preview-panel', 'inspector-panel']) {
    assert.ok(shell.querySelector(`.panel.${cls}`), `has .panel.${cls}`);
  }
  assert.ok(shell.querySelector('[role="status"]'), 'has a status element');

  // Idempotent: a second show reuses the existing skeleton.
  showEditorLoadingSkeleton(root);
  assert.equal(
    root.querySelectorAll('.editor-loading-skeleton').length,
    1,
    'no duplicate skeletons'
  );

  hide();
  assert.equal(root.querySelector('.editor-loading-skeleton'), null);

  // hideEditorLoadingSkeleton clears skeletons it did not create.
  showEditorLoadingSkeleton(root);
  hideEditorLoadingSkeleton(root);
  assert.equal(root.querySelector('.editor-loading-skeleton'), null);
});

test('loadEditorModel skips the presentation fetch when initialPres is given', async () => {
  const calls = [];
  const fakeApi = async (path) => {
    calls.push(path);
    if (path.startsWith('/api/presentations/')) {
      throw new Error('presentation must not be re-fetched');
    }
    // slide types / editor assets endpoints: minimal empty answers
    return {};
  };

  const initialPres = {
    id: 'test-id',
    title: 'Deck',
    slides: [{ id: 's1', type: 'text-slide', content: {} }],
  };

  const model = await loadEditorModel({
    id: 'test-id',
    api: fakeApi,
    startUrl: new URL('http://localhost/app/test-id'),
    initialPres,
  });

  assert.equal(model.pres, initialPres, 'returns the given presentation');
  assert.ok(
    !calls.some((p) => p.startsWith('/api/presentations/test-id')),
    'no duplicate presentation fetch'
  );
});

test('loadEditorModel still fetches when initialPres is absent', async () => {
  const calls = [];
  const fakeApi = async (path) => {
    calls.push(path);
    if (path.startsWith('/api/presentations/')) {
      return { id: 'test-id', title: 'Deck', slides: [] };
    }
    return {};
  };

  await loadEditorModel({
    id: 'test-id',
    api: fakeApi,
    startUrl: new URL('http://localhost/app/test-id'),
  });

  assert.ok(
    calls.some((p) => p.startsWith('/api/presentations/test-id')),
    'fetches the presentation itself'
  );
});
