/**
 * Deck overview thumbnails (front-page-perf, Fase B).
 *
 * Covers the Chrome-free logic: the cache identity (deterministic, invalidated
 * by deck revision + theme), the cache read + single-flight short-circuit, and
 * the route's auth gate / cache-hit serve / method guard. The actual headless
 * render (`renderSlideToPngBuffer`) is exercised by the PNG-export path and is
 * deliberately not invoked here.
 *
 * Run with: node --test tests/deck-thumbnail.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

import {
  thumbCacheKey,
  readCachedThumbnail,
  requestThumbnailGeneration,
} from '../server/render/deck-thumbnail.js';
import { dataDir } from '../server/config/storage-paths.js';
import { createPresentation, getPresentation } from '../server/storage/presentations.js';
import { loadTheme } from '../server/utils/themes.js';
import { handlePresentationThumbnail } from '../server/routes/api/presentations/thumbnail.js';

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(buf) {
      this.body = buf;
      this.ended = true;
    },
  };
}

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-thumb-'));
}

// ── Cache identity ──────────────────────────────────────────────────────────

test('thumbCacheKey is deterministic and filesystem-safe', () => {
  const pres = { id: 'abc/../x', revision: 3, theme: 'default' };
  const a = thumbCacheKey(pres, { id: 'default' });
  const b = thumbCacheKey(pres, { id: 'default' });
  assert.equal(a.filename, b.filename, 'same inputs → same filename');
  assert.match(a.filename, /\.webp$/, 'served as webp');
  assert.doesNotMatch(a.filename, /[/.]{2}/, 'no path traversal in the filename');
});

test('cache key changes when the deck revision changes', () => {
  const theme = { id: 'default' };
  const r1 = thumbCacheKey({ id: 'deck1', revision: 1, theme: 'default' }, theme);
  const r2 = thumbCacheKey({ id: 'deck1', revision: 2, theme: 'default' }, theme);
  assert.notEqual(r1.filename, r2.filename, 'a deck edit invalidates the raster');
});

test('cache key changes when the theme changes', () => {
  const pres = { id: 'deck1', revision: 1, theme: 'default' };
  const t1 = thumbCacheKey(pres, { id: 'default', colors: { bg: '#fff' } });
  const t2 = thumbCacheKey(pres, { id: 'default', colors: { bg: '#000' } });
  assert.notEqual(t1.filename, t2.filename, 'editing the theme invalidates the raster');
});

// ── Cache read + single-flight ──────────────────────────────────────────────

test('readCachedThumbnail: miss → null, hit → buffer', async () => {
  const repoRoot = await tmpRoot();
  assert.equal(await readCachedThumbnail(repoRoot, 'missing.webp'), null);

  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'hit.webp'), Buffer.from('webp-bytes'));
  const buf = await readCachedThumbnail(repoRoot, 'hit.webp');
  assert.ok(buf && buf.equals(Buffer.from('webp-bytes')));
});

test('requestThumbnailGeneration short-circuits (no render) when already cached', async () => {
  const repoRoot = await tmpRoot();
  const pres = { id: 'deck-cached', revision: 1, theme: 'default' };
  const theme = { id: 'default' };
  const { filename } = thumbCacheKey(pres, theme);

  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), Buffer.from('already-here'));

  // A null slide would throw inside the real renderer; the cache short-circuit
  // means we never reach it.
  const ok = await requestThumbnailGeneration(repoRoot, pres, null, theme, null);
  assert.equal(ok, true, 'resolves true from the cache without rendering');
});

// ── Route: auth, cache-hit, method guard ────────────────────────────────────

test('route serves a cached webp to the owner', async () => {
  const repoRoot = await tmpRoot();
  const created = await createPresentation(repoRoot, {
    title: 'Owned deck',
    ownerEmail: 'owner@example.com',
    scope: 'private',
    slides: [{ id: 's1', type: 'text-slide', content: { title: 'Hi' } }],
  });
  const pres = await getPresentation(repoRoot, created.id);
  const theme = await loadTheme(repoRoot, pres.theme);
  const { filename } = thumbCacheKey(pres, theme);

  const webp = await sharp({
    create: { width: 800, height: 450, channels: 3, background: '#3355ff' },
  })
    .webp({ quality: 80 })
    .toBuffer();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), webp);

  const res = mockRes();
  const handled = await handlePresentationThumbnail(
    { repoRoot, req: { method: 'GET' }, res, authedUser: { email: 'owner@example.com' } },
    created.id
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/webp');
  assert.ok(res.body.equals(webp), 'serves the cached bytes verbatim');
});

test('route denies a non-owner on a private deck', async () => {
  const repoRoot = await tmpRoot();
  const created = await createPresentation(repoRoot, {
    title: 'Private deck',
    ownerEmail: 'owner@example.com',
    scope: 'private',
    slides: [{ id: 's1', type: 'text-slide', content: { title: 'Hi' } }],
  });

  const res = mockRes();
  await handlePresentationThumbnail(
    { repoRoot, req: { method: 'GET' }, res, authedUser: { email: 'intruder@example.com' } },
    created.id
  );
  assert.equal(res.statusCode, 401, 'private deck thumbnails require read access');
});

test('route 404s for an unknown deck', async () => {
  const repoRoot = await tmpRoot();
  const res = mockRes();
  await handlePresentationThumbnail(
    { repoRoot, req: { method: 'GET' }, res, authedUser: { email: 'owner@example.com' } },
    'does-not-exist'
  );
  assert.equal(res.statusCode, 404);
});

test('route rejects non-GET methods', async () => {
  const repoRoot = await tmpRoot();
  const res = mockRes();
  await handlePresentationThumbnail(
    { repoRoot, req: { method: 'POST' }, res, authedUser: { email: 'x@example.com' } },
    'whatever'
  );
  assert.equal(res.statusCode, 405);
});
