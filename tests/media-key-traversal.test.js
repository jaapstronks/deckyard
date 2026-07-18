import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LocalProvider } from '../server/media/local.js';

/**
 * Security hardening 5b: the LocalProvider must confine confirmUpload /
 * deleteFile keys to uploadsDir so a traversal key can't be used as an
 * existence/size oracle for arbitrary files, nor delete files outside uploads.
 */

async function makeProvider() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-media-'));
  process.env.UPLOADS_DIR = path.join(root, 'uploads');
  const provider = new LocalProvider(root);
  await fs.mkdir(provider.uploadsDir, { recursive: true });
  return { root, provider };
}

test('confirmUpload confirms a real key inside uploadsDir', async () => {
  const { provider } = await makeProvider();
  await fs.writeFile(path.join(provider.uploadsDir, 'real.png'), 'x');
  const res = await provider.confirmUpload('real.png');
  assert.equal(res.exists, true);
  assert.equal(res.publicUrl, '/uploads/real.png');
});

test('confirmUpload refuses to stat a file outside uploadsDir', async () => {
  const { root, provider } = await makeProvider();
  // A secret file outside uploads that definitely exists.
  const secret = path.join(root, 'secret.txt');
  await fs.writeFile(secret, 'top secret');
  for (const key of [
    '../secret.txt',
    '../../etc/passwd',
    path.resolve(secret), // absolute
    '/etc/passwd',
  ]) {
    const res = await provider.confirmUpload(key);
    assert.deepEqual(
      res,
      { exists: false, publicUrl: '' },
      `traversal key ${JSON.stringify(key)} must not leak existence`
    );
  }
});

test('deleteFile refuses to unlink outside uploadsDir', async () => {
  const { root, provider } = await makeProvider();
  const secret = path.join(root, 'keep.txt');
  await fs.writeFile(secret, 'do not delete');
  const ok = await provider.deleteFile('../keep.txt');
  assert.equal(ok, false);
  // File must still be there.
  await assert.doesNotReject(fs.access(secret));
});

test('deleteFile still works for a valid in-uploads key', async () => {
  const { provider } = await makeProvider();
  const p = path.join(provider.uploadsDir, 'gone.png');
  await fs.writeFile(p, 'x');
  const ok = await provider.deleteFile('gone.png');
  assert.equal(ok, true);
  await assert.rejects(fs.access(p));
});

test('non-string / empty / NUL keys are rejected', async () => {
  const { provider } = await makeProvider();
  for (const key of ['', 'file\0.png', null, undefined, 42]) {
    const res = await provider.confirmUpload(key);
    assert.equal(res.exists, false, `key ${JSON.stringify(key)}`);
    assert.equal(await provider.deleteFile(key), false, `key ${JSON.stringify(key)}`);
  }
});
