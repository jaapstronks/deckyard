import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.FileReader = dom.window.FileReader;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.URL.createObjectURL = () => 'blob:batch-test';
globalThis.URL.revokeObjectURL = () => {};

const { openImageBatch } =
  await import('../client/views/editor/image-library/batch.js');

const file = (name) =>
  new dom.window.File(['image bytes'], name, { type: 'image/png' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('batch dialog did not reach the expected state');
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function dialog() {
  return document.querySelector('.image-batch-modal');
}
function action(index) {
  return dialog().querySelectorAll('.image-batch-actions button')[index];
}
function fillAlts() {
  for (const row of dialog().querySelectorAll('.image-batch-row')) {
    for (const input of row.querySelectorAll('.image-batch-fields input')) {
      input.value = `Alt for ${row.querySelector('strong').textContent}`;
    }
  }
}
function closeAndClean(batch) {
  batch.close();
  document.body.replaceChildren();
}

test('retry after a definite metadata failure reuses uploaded URLs and confirmed ids', async () => {
  const calls = [];
  const picks = [];
  let failSecond = true;
  const api = async (path, opts) => {
    calls.push({ path, body: opts?.body });
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      if (opts.body.url.endsWith('second.png') && failSecond) {
        failSecond = false;
        throw Object.assign(new Error('Storage temporarily unavailable'), {
          code: 'storage_error',
        });
      }
      return {
        id: opts.body.url.endsWith('first.png') ? 'id-first' : 'id-second',
      };
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('first.png'), file('second.png')],
    onPickMany: (images) => picks.push(images),
  });
  await until(
    () =>
      [...dialog().querySelectorAll('.image-batch-row .help')].filter(
        (el) => el.textContent === 'Uploaded',
      ).length === 2,
  );
  fillAlts();
  action(0).click();
  await until(() => !action(2).hidden);
  assert.equal(
    picks.length,
    0,
    'partial save never mutates the slide automatically',
  );
  action(2).click();
  await until(() => picks.length === 1);
  assert.deepEqual(
    picks[0].map((pick) => pick.id),
    ['id-first', 'id-second'],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.path === '/api/uploads')
      .map((call) => call.body.originalName),
    ['first.png', 'second.png'],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.path === '/api/image-library')
      .map((call) => call.body.url),
    ['/uploads/first.png', '/uploads/second.png', '/uploads/second.png'],
  );
  closeAndClean(batch);
});

test('uncertain metadata result cannot be retried blindly', async () => {
  let posts = 0;
  let applied = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      posts += 1;
      throw new Error('Network disconnected');
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('uncertain.png')],
    onPickMany: () => {
      applied += 1;
    },
  });
  await until(
    () =>
      dialog()?.querySelector('.image-batch-row .help')?.textContent ===
      'Uploaded',
  );
  fillAlts();
  action(0).click();
  await until(() =>
    dialog()?.textContent.includes('Saving may have succeeded'),
  );
  assert.equal(action(2).hidden, true);
  assert.equal(action(0).disabled, true);
  assert.equal(posts, 1);
  assert.equal(applied, 0);
  closeAndClean(batch);
});

test('double-clicking Save during a pending POST starts one commit', async () => {
  const pending = deferred();
  let posts = 0;
  let applied = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      posts += 1;
      return pending.promise;
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('once.png')],
    onPickMany: () => {
      applied += 1;
    },
  });
  await until(
    () =>
      dialog()?.querySelector('.image-batch-row .help')?.textContent ===
      'Uploaded',
  );
  fillAlts();
  action(0).click();
  action(0).click();
  await until(() => posts === 1);
  pending.resolve({ id: 'once-id' });
  await until(() => applied === 1);
  assert.equal(posts, 1);
  closeAndClean(batch);
});

test('stopping during uploads does not start queued files or apply the slide', async () => {
  const uploads = [];
  let applied = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads') {
      const pending = deferred();
      uploads.push({ name: opts.body.originalName, ...pending });
      return pending.promise;
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [
      file('one.png'),
      file('two.png'),
      file('three.png'),
      file('four.png'),
    ],
    onPickMany: () => {
      applied += 1;
    },
  });
  await until(() => uploads.length === 3);
  action(4).click();
  uploads.forEach(({ name, resolve }) => resolve({ url: `/uploads/${name}` }));
  await until(() =>
    dialog()?.textContent.includes('The slide was not changed'),
  );
  assert.equal(uploads.length, 3);
  assert.equal(applied, 0);
  closeAndClean(batch);
});

test('stopping during metadata save preserves stored record and skips remaining POSTs', async () => {
  const firstPost = deferred();
  let posts = 0;
  let applied = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      posts += 1;
      return firstPost.promise;
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('one.png'), file('two.png')],
    onPickMany: () => {
      applied += 1;
    },
  });
  await until(
    () =>
      [...dialog().querySelectorAll('.image-batch-row .help')].filter(
        (el) => el.textContent === 'Uploaded',
      ).length === 2,
  );
  fillAlts();
  action(0).click();
  await until(() => posts === 1);
  action(4).click();
  firstPost.resolve({ id: 'stored-before-stop' });
  await until(() => dialog()?.textContent.includes('1 images were saved'));
  assert.equal(posts, 1);
  assert.equal(applied, 0);
  closeAndClean(batch);
});
