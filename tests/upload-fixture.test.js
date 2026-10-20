import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withTestUploads } from './helpers/upload-fixture.js';

async function fixtureRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-uploads-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function uploadedFiles(root) {
  return fs.readdir(path.join(root, 'server', 'uploads'));
}

test('upload scope returns a URL, preserves bytes, then removes its file', async (t) => {
  const root = await fixtureRoot(t);
  const bytes = Buffer.from([0, 1, 255]);
  const url = await withTestUploads(root, async (add) => {
    const uploaded = await add(bytes, { prefix: 'example-', ext: 'png' });
    assert.match(uploaded, /^\/uploads\/example-[\da-f-]+\.png$/);
    assert.deepEqual(
      await fs.readFile(path.join(root, 'server', uploaded.slice(1))),
      bytes,
    );
    return uploaded;
  });
  assert.match(url, /^\/uploads\/example-[\da-f-]+\.png$/);
  assert.deepEqual(await uploadedFiles(root), []);
});

test('upload scope removes its file when the callback fails', async (t) => {
  const root = await fixtureRoot(t);
  const failure = new Error('callback failed');
  await assert.rejects(
    withTestUploads(root, async (add) => {
      await add('first', { prefix: 'example-', ext: 'jpg' });
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(await uploadedFiles(root), []);
});

test('a later partial write removes both earlier and incomplete uploads', async (t) => {
  const root = await fixtureRoot(t);
  const failure = new Error('write failed');
  let partialFile;
  async function* incompleteBytes() {
    yield Buffer.from('partial');
    const files = await uploadedFiles(root);
    assert.equal(files.length, 2);
    partialFile = files.find((file) => file.startsWith('second-'));
    assert.equal(
      await fs.readFile(
        path.join(root, 'server', 'uploads', partialFile),
        'utf8',
      ),
      'partial',
    );
    throw failure;
  }

  await assert.rejects(
    withTestUploads(root, async (add) => {
      await add('first', { prefix: 'first-', ext: 'png' });
      await add(incompleteBytes(), { prefix: 'second-', ext: 'png' });
    }),
    (error) => error === failure,
  );
  assert.ok(partialFile);
  assert.deepEqual(await uploadedFiles(root), []);
});
