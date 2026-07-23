/**
 * Local-upload thumbnail variants (Fase A, rest).
 *
 * handleUploadVariant() serves a sharp-resized, disk-cached copy of a
 * `/uploads/…` image when the request carries an allowlisted `?w=<n>`, and
 * falls through (returns false) for every other case: no width, disallowed
 * width, non-raster, path traversal, missing file.
 *
 * Run with: node --test tests/upload-variant.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { handleUploadVariant } from '../server/routes/static/upload-variant.js';

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(buf) {
      this.body = buf;
    },
  };
}

/** Build a ctx for a GET request to `/uploads/<pathAndQuery>`. */
function ctxFor(pathAndQuery, { repoRoot, uploadsDir, method = 'GET' } = {}) {
  return {
    req: { method },
    res: mockRes(),
    url: new URL(`http://localhost${pathAndQuery}`),
    repoRoot,
    sharedPublicDirs: [{ urlPrefix: '/uploads/', dir: uploadsDir }],
  };
}

async function setup() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-variant-'));
  const uploadsDir = path.join(repoRoot, 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const png = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#3355ff' },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(uploadsDir, 'pic.png'), png);
  return { repoRoot, uploadsDir };
}

test('serves a resized, correctly-typed variant for an allowlisted width', async () => {
  const { repoRoot, uploadsDir } = await setup();
  const ctx = ctxFor('/uploads/pic.png?w=800', { repoRoot, uploadsDir });
  const handled = await handleUploadVariant(ctx);

  assert.equal(handled, true);
  assert.equal(ctx.res.statusCode, 200);
  assert.equal(ctx.res.headers['Content-Type'], 'image/png');
  assert.match(ctx.res.headers['Cache-Control'], /max-age=/);
  const meta = await sharp(ctx.res.body).metadata();
  assert.equal(meta.width, 800, 'downscaled to the requested width');
});

test('second request is served from the on-disk cache', async () => {
  const { repoRoot, uploadsDir } = await setup();
  await handleUploadVariant(ctxFor('/uploads/pic.png?w=800', { repoRoot, uploadsDir }));
  const cacheDir = path.join(repoRoot, 'server', 'data', 'thumb-variants');
  const cached = await fs.readdir(cacheDir);
  assert.equal(cached.length, 1, 'one cache file written');

  const ctx = ctxFor('/uploads/pic.png?w=800', { repoRoot, uploadsDir });
  const handled = await handleUploadVariant(ctx);
  assert.equal(handled, true);
  const meta = await sharp(ctx.res.body).metadata();
  assert.equal(meta.width, 800);
});

test('HEAD returns headers without a body', async () => {
  const { repoRoot, uploadsDir } = await setup();
  const ctx = ctxFor('/uploads/pic.png?w=800', { repoRoot, uploadsDir, method: 'HEAD' });
  const handled = await handleUploadVariant(ctx);
  assert.equal(handled, true);
  assert.equal(ctx.res.statusCode, 200);
  assert.equal(ctx.res.body, undefined);
});

test('falls through (false) for disallowed widths, no width, non-raster, and POST', async () => {
  const { repoRoot, uploadsDir } = await setup();
  for (const [pq, opts] of [
    ['/uploads/pic.png?w=777', {}], // width not on the allowlist
    ['/uploads/pic.png', {}], // no width param
    ['/uploads/pic.svg?w=800', {}], // non-raster extension
    ['/uploads/pic.png?w=800', { method: 'POST' }], // wrong method
  ]) {
    const ctx = ctxFor(pq, { repoRoot, uploadsDir, ...opts });
    assert.equal(await handleUploadVariant(ctx), false, `falls through: ${pq}`);
    assert.equal(ctx.res.statusCode, null, 'no response written');
  }
});

test('rejects path traversal outside the uploads dir', async () => {
  const { repoRoot, uploadsDir } = await setup();
  // Secret sits next to (not inside) the uploads dir.
  await fs.writeFile(path.join(repoRoot, 'secret.png'), 'x');
  const ctx = ctxFor('/uploads/%2e%2e/secret.png?w=800', { repoRoot, uploadsDir });
  assert.equal(await handleUploadVariant(ctx), false);
  assert.equal(ctx.res.statusCode, null);
});

test('falls through for a missing file', async () => {
  const { repoRoot, uploadsDir } = await setup();
  const ctx = ctxFor('/uploads/nope.png?w=800', { repoRoot, uploadsDir });
  assert.equal(await handleUploadVariant(ctx), false);
});
