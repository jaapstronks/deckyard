/**
 * Deck overview thumbnails (front-page-perf, Fase B).
 *
 * Covers the Chrome-free logic: the cache identity (deterministic, invalidated
 * by slide 1 + theme but *not* by the deck revision), stale-while-revalidate,
 * pruning, the cache read + single-flight short-circuit, and
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
  readStaleThumbnail,
  pruneOldThumbnails,
  requestThumbnailGeneration,
} from '../server/render/deck-thumbnail.js';
import { dataDir } from '../server/config/storage-paths.js';
import { loadTheme } from '../server/utils/themes.js';
import { handlePresentationThumbnail } from '../server/routes/api/presentations/thumbnail.js';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { createPresentation, getPresentation, updatePresentation } = await import(
  '../server/storage/presentations/index.js'
);

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

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

/**
 * A throwaway root for the on-disk raster cache (`dataDir(root)/deck-thumbs`).
 * Decks themselves live in the database double, not under this root.
 */
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

test('cache key ignores the deck revision', () => {
  // The revision bumps on every save, including saves that never touch slide 1.
  // Keying on it made "open a deck and close it again" a guaranteed cache miss,
  // and a miss costs the card a ~10s placeholder shimmer.
  const theme = { id: 'default' };
  const slides = [{ id: 's1', type: 'title-slide', content: { title: 'Hello' } }];
  const r1 = thumbCacheKey({ id: 'deck1', revision: 1, theme: 'default', slides }, theme);
  const r2 = thumbCacheKey({ id: 'deck1', revision: 9, theme: 'default', slides }, theme);
  assert.equal(r1.filename, r2.filename, 'an edit elsewhere in the deck keeps the raster valid');
});

test('cache key changes when slide 1 changes', () => {
  const theme = { id: 'default' };
  const base = { id: 'deck1', revision: 1, theme: 'default' };
  const r1 = thumbCacheKey(
    { ...base, slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hello' } }] },
    theme
  );
  const r2 = thumbCacheKey(
    { ...base, slides: [{ id: 's1', type: 'title-slide', content: { title: 'Changed' } }] },
    theme
  );
  assert.notEqual(r1.filename, r2.filename, 'editing slide 1 invalidates the raster');
});

test('cache key ignores slides after the first', () => {
  const theme = { id: 'default' };
  const first = { id: 's1', type: 'title-slide', content: { title: 'Hello' } };
  const r1 = thumbCacheKey({ id: 'deck1', theme: 'default', slides: [first] }, theme);
  const r2 = thumbCacheKey(
    { id: 'deck1', theme: 'default', slides: [first, { id: 's2', type: 'content-slide' }] },
    theme
  );
  assert.equal(r1.filename, r2.filename, 'only slide 1 is rasterized, so only slide 1 counts');
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
  const created = await createPresentation(testScope(), {
    title: 'Owned deck',
    ownerEmail: 'owner@example.com',
    scope: 'private',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
  });
  const pres = await getPresentation(testScope(), created.id);
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
    { repoRoot, storageScope: testScope(), req: { method: 'GET' }, res, authedUser: { email: 'owner@example.com' } },
    created.id
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/webp');
  assert.ok(res.body.equals(webp), 'serves the cached bytes verbatim');
});

test('route denies a non-owner on a private deck', async () => {
  const repoRoot = await tmpRoot();
  const created = await createPresentation(testScope(), {
    title: 'Private deck',
    ownerEmail: 'owner@example.com',
    scope: 'private',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
  });

  const res = mockRes();
  await handlePresentationThumbnail(
    { repoRoot, storageScope: testScope(), req: { method: 'GET' }, res, authedUser: { email: 'intruder@example.com' } },
    created.id
  );
  assert.equal(res.statusCode, 401, 'private deck thumbnails require read access');
});

test('route 404s for an unknown deck', async () => {
  const repoRoot = await tmpRoot();
  const res = mockRes();
  await handlePresentationThumbnail(
    { repoRoot, storageScope: testScope(), req: { method: 'GET' }, res, authedUser: { email: 'owner@example.com' } },
    'does-not-exist'
  );
  assert.equal(res.statusCode, 404);
});

test('route rejects non-GET methods', async () => {
  const repoRoot = await tmpRoot();
  const res = mockRes();
  await handlePresentationThumbnail(
    { repoRoot, storageScope: testScope(), req: { method: 'POST' }, res, authedUser: { email: 'x@example.com' } },
    'whatever'
  );
  assert.equal(res.statusCode, 405);
});

// ── Stale-while-revalidate + pruning ────────────────────────────────────────

test('readStaleThumbnail returns the newest other raster for the same deck', async () => {
  const repoRoot = await tmpRoot();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(path.join(dir, 'deck1-aaaaaaaaaaaaaaaa.webp'), Buffer.from('old'));
  await fs.writeFile(path.join(dir, 'deck1-bbbbbbbbbbbbbbbb.webp'), Buffer.from('newer'));
  // Make the ordering unambiguous regardless of filesystem timestamp resolution.
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(path.join(dir, 'deck1-aaaaaaaaaaaaaaaa.webp'), past, past);
  // A different deck must never be borrowed from.
  await fs.writeFile(path.join(dir, 'deck2-cccccccccccccccc.webp'), Buffer.from('other deck'));

  const stale = await readStaleThumbnail(repoRoot, 'deck1', 'deck1-fresh.webp');
  assert.ok(stale, 'found a previous raster');
  assert.equal(stale.buffer.toString(), 'newer');

  // The key we are waiting on is never offered back as its own stale fallback.
  const self = await readStaleThumbnail(repoRoot, 'deck1', 'deck1-bbbbbbbbbbbbbbbb.webp');
  assert.equal(self.buffer.toString(), 'old');

  assert.equal(await readStaleThumbnail(repoRoot, 'deck-none', 'x.webp'), null);
});

test('pruneOldThumbnails keeps only the current raster for that deck', async () => {
  const repoRoot = await tmpRoot();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'deck1-keep.webp'), Buffer.from('keep'));
  await fs.writeFile(path.join(dir, 'deck1-old1.webp'), Buffer.from('drop'));
  await fs.writeFile(path.join(dir, 'deck1-old2.webp'), Buffer.from('drop'));
  await fs.writeFile(path.join(dir, 'deck2-other.webp'), Buffer.from('untouched'));

  await pruneOldThumbnails(repoRoot, 'deck1', 'deck1-keep.webp');

  const left = (await fs.readdir(dir)).sort();
  assert.deepEqual(left, ['deck1-keep.webp', 'deck2-other.webp']);
});

test('route serves the previous raster instead of 404 while the new one renders', async () => {
  const repoRoot = await tmpRoot();
  // The deck is emptied after creation (createPresentation seeds a title slide
  // when given none), so the route reaches the stale branch without kicking off
  // a real headless-Chrome render, which would outlive the test process. The
  // branch under test is the fallback: fresh key absent, previous raster present.
  const created = await createPresentation(testScope(), {
    title: 'Edited deck',
    ownerEmail: 'owner@example.com',
    scope: 'private',
    slides: [],
  });
  const seeded = await getPresentation(testScope(), created.id);
  await updatePresentation(testScope(), created.id, { ...seeded, slides: [] }, {
    expectedRevision: seeded.revision,
  });
  const pres = await getPresentation(testScope(), created.id);
  const theme = await loadTheme(repoRoot, pres.theme);
  const { prefix, filename } = thumbCacheKey(pres, theme);

  const webp = await sharp({
    create: { width: 800, height: 450, channels: 3, background: '#112233' },
  })
    .webp({ quality: 80 })
    .toBuffer();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  // A raster from a *previous* slide-1 state: same deck prefix, different sig.
  assert.notEqual(filename, `${prefix}-0000000000000000.webp`);
  await fs.writeFile(path.join(dir, `${prefix}-0000000000000000.webp`), webp);

  const res = mockRes();
  await handlePresentationThumbnail(
    { repoRoot, storageScope: testScope(), req: { method: 'GET' }, res, authedUser: { email: 'owner@example.com' } },
    created.id
  );
  assert.equal(res.statusCode, 200, 'stale beats a placeholder');
  assert.equal(res.headers['Content-Type'], 'image/webp');
  assert.ok(res.body.equals(webp));
  assert.match(
    res.headers['Cache-Control'],
    /max-age=10\b/,
    'stale is served with a short max-age so it revalidates quickly'
  );
});
