/**
 * The vision helper sends a local image's bytes to the vendor, on a URL from a
 * request body (DY-817). It may read only what this installation serves as an
 * asset: a traversal must be refused, not resolved to a file elsewhere on disk.
 *
 * Run with: node --test tests/llm-vision-input.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ValidationError } from '../server/utils/errors.js';
import { resolveImageUrlForVisionInput } from '../server/utils/llm/vision.js';
import { generateImageAltTexts } from '../server/utils/llm/alt-text.js';

process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

const PIXEL = Buffer.from('a local image');
const DATA_URL = `data:image/png;base64,${PIXEL.toString('base64')}`;

/** An installation with one upload, one asset and files just outside both. */
function installation(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-dy817-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const uploads = path.join(root, 'uploads');
  const previous = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = uploads;
  t.after(() => {
    if (previous === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previous;
  });
  fs.mkdirSync(uploads);
  fs.mkdirSync(path.join(root, 'assets', 'logos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'custom', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'ok.png'), PIXEL);
  fs.writeFileSync(path.join(root, 'assets', 'logos', 'ok.png'), PIXEL);
  fs.writeFileSync(path.join(root, 'custom', 'assets', 'ok.png'), PIXEL);
  fs.writeFileSync(path.join(root, 'secret.png'), 'outside every served dir');
  return root;
}

for (const url of [
  '/uploads/../secret.png',
  '/uploads/../../../../../../etc/secret.png',
  '/assets/../secret.png',
  '/assets/logos/../../secret.png',
  '/custom/assets/../../secret.png',
  '/uploads/%2e%2e/secret.png',
  '/uploads/..%2fsecret.png',
  '/uploads/..\\secret.png',
  '/uploads/../secret.svg',
  '/secret.png',
  '//evil.example/secret.png',
  '/client/secret.png',
]) {
  test(`refuses ${url}`, async (t) => {
    const root = installation(t);
    await assert.rejects(
      resolveImageUrlForVisionInput(root, url),
      ValidationError,
    );
  });
}

test('a refused path reaches neither the disk nor the vendor', async (t) => {
  const root = installation(t);
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    throw new Error('the vendor must not be called');
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  await assert.rejects(
    generateImageAltTexts({
      repoRoot: root,
      imageUrl: '/uploads/../secret.png',
      langs: ['nl'],
    }),
    ValidationError,
  );
  assert.equal(called, 0);
});

for (const url of [
  '/uploads/ok.png',
  '/assets/logos/ok.png',
  '/custom/assets/ok.png',
]) {
  test(`embeds ${url}`, async (t) => {
    const root = installation(t);
    assert.deepEqual(await resolveImageUrlForVisionInput(root, url), {
      type: 'data',
      url: DATA_URL,
    });
  });
}

test('what never touched the disk keeps its answer', async (t) => {
  const root = installation(t);
  const cases = [
    ['', { type: 'none', url: '' }],
    [
      'https://cdn.example/a.png',
      { type: 'remote', url: 'https://cdn.example/a.png' },
    ],
    ['/uploads/ok.svg', { type: 'unsupported', url: '/uploads/ok.svg' }],
    ['relative.png', { type: 'unknown', url: 'relative.png' }],
  ];
  for (const [url, expected] of cases) {
    assert.deepEqual(
      await resolveImageUrlForVisionInput(root, url),
      expected,
      url,
    );
  }
});

test('an image over the limit is refused', async (t) => {
  const root = installation(t);
  fs.writeFileSync(
    path.join(root, 'uploads', 'big.png'),
    Buffer.alloc(4 * 1024 * 1024 + 1),
  );
  await assert.rejects(
    resolveImageUrlForVisionInput(root, '/uploads/big.png'),
    /too large/i,
  );
});
