/**
 * Deck overview thumbnails (front-page-perf, Fase B).
 *
 * Covers the Chrome-free logic: the cache identity (deterministic, invalidated
 * by slide 1 + theme but *not* by the deck revision), stale-while-revalidate,
 * pruning, the cache read + single-flight short-circuit, and the route's auth
 * gate / cache-hit serve / conditional-GET handling / method guard. The actual
 * headless render (`renderSlideToPngBuffer`) is exercised by the PNG-export path
 * and is deliberately not invoked here.
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
  pruneDeckThumbnails,
  requestThumbnailGeneration,
} from '../server/render/deck-thumbnail.js';
import { dataDir } from '../server/config/storage-paths.js';
import { loadThemeAssets } from '../server/utils/themes.js';
import { handlePresentationThumbnail } from '../server/routes/api/presentations/thumbnail.js';
import { testScope } from './helpers/storage-scope.js';
import { sessionFor, userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const {
  createPresentation,
  getPresentation,
  updatePresentation,
  deletePresentation,
} = await import('../server/storage/presentations/index.js');
const { handlePresentationPermanentDelete } =
  await import('../server/routes/api/presentations/trash.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      // The owner needs a `users` row: a deck's `owner_user_id` is resolved
      // from the address at create, and ownership is decided on that id alone
      // (shared/identity-match.js).
      users: userRows('owner@example.com'),
    }),
  );
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
  assert.doesNotMatch(
    a.filename,
    /[/.]{2}/,
    'no path traversal in the filename',
  );
});

test('cache key ignores the deck revision', () => {
  // The revision bumps on every save, including saves that never touch slide 1.
  // Keying on it made "open a deck and close it again" a guaranteed cache miss,
  // and a miss costs the card a ~10s placeholder shimmer.
  const theme = { id: 'default' };
  const slides = [
    { id: 's1', type: 'title-slide', content: { title: 'Hello' } },
  ];
  const r1 = thumbCacheKey(
    { id: 'deck1', revision: 1, theme: 'default', slides },
    theme,
  );
  const r2 = thumbCacheKey(
    { id: 'deck1', revision: 9, theme: 'default', slides },
    theme,
  );
  assert.equal(
    r1.filename,
    r2.filename,
    'an edit elsewhere in the deck keeps the raster valid',
  );
});

test('cache key changes when slide 1 changes', () => {
  const theme = { id: 'default' };
  const base = { id: 'deck1', revision: 1, theme: 'default' };
  const r1 = thumbCacheKey(
    {
      ...base,
      slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hello' } }],
    },
    theme,
  );
  const r2 = thumbCacheKey(
    {
      ...base,
      slides: [
        { id: 's1', type: 'title-slide', content: { title: 'Changed' } },
      ],
    },
    theme,
  );
  assert.notEqual(
    r1.filename,
    r2.filename,
    'editing slide 1 invalidates the raster',
  );
});

test('cache key ignores slides after the first', () => {
  const theme = { id: 'default' };
  const first = { id: 's1', type: 'title-slide', content: { title: 'Hello' } };
  const r1 = thumbCacheKey(
    { id: 'deck1', theme: 'default', slides: [first] },
    theme,
  );
  const r2 = thumbCacheKey(
    {
      id: 'deck1',
      theme: 'default',
      slides: [first, { id: 's2', type: 'content-slide' }],
    },
    theme,
  );
  assert.equal(
    r1.filename,
    r2.filename,
    'only slide 1 is rasterized, so only slide 1 counts',
  );
});

test('cache key changes when the theme changes', () => {
  const pres = { id: 'deck1', revision: 1, theme: 'default' };
  const t1 = thumbCacheKey(pres, { id: 'default', colors: { bg: '#fff' } });
  const t2 = thumbCacheKey(pres, { id: 'default', colors: { bg: '#000' } });
  assert.notEqual(
    t1.filename,
    t2.filename,
    'editing the theme invalidates the raster',
  );
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
  const ok = await requestThumbnailGeneration(
    repoRoot,
    pres,
    null,
    theme,
    null,
  );
  assert.equal(ok, true, 'resolves true from the cache without rendering');
});

// ── Route: auth, cache-hit, method guard ────────────────────────────────────

test('route serves a cached webp to the owner', async () => {
  const repoRoot = await tmpRoot();
  const created = await createPresentation(testScope(), {
    title: 'Owned deck',
    ownerEmail: 'owner@example.com',
    visibility: 'private',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
  });
  const pres = await getPresentation(testScope(), created.id);
  const theme = await loadThemeAssets(repoRoot, pres.theme);
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
    {
      repoRoot,
      storageScope: testScope(),
      req: { method: 'GET' },
      res,
      authedUser: sessionFor('owner@example.com'),
    },
    created.id,
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/webp');
  assert.ok(res.body.equals(webp), 'serves the cached bytes verbatim');
});

// ── Route: conditional GET ──────────────────────────────────────────────────

/**
 * A deck with one cached raster on disk, plus the tag the route will hand out
 * for it. The cache filename *is* `sha1(deck | slide 1 | theme)`, so the ETag
 * needs nothing hashed on top of it.
 */
async function seedCachedDeck(repoRoot, title) {
  const created = await createPresentation(testScope(), {
    title,
    ownerEmail: 'owner@example.com',
    visibility: 'private',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
  });
  const pres = await getPresentation(testScope(), created.id);
  const theme = await loadThemeAssets(repoRoot, pres.theme);
  const { filename } = thumbCacheKey(pres, theme);

  const webp = await sharp({
    create: { width: 800, height: 450, channels: 3, background: '#3355ff' },
  })
    .webp({ quality: 80 })
    .toBuffer();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), webp);

  return { id: created.id, webp, etag: `"${filename}"` };
}

/** GET the thumbnail as its owner, optionally conditionally. */
function getThumbnail(repoRoot, id, headers = {}) {
  const res = mockRes();
  return handlePresentationThumbnail(
    {
      repoRoot,
      storageScope: testScope(),
      req: { method: 'GET', headers },
      res,
      authedUser: sessionFor('owner@example.com'),
    },
    id,
  ).then(() => res);
}

test('a second request holding the current ETag gets a bodiless 304', async () => {
  const repoRoot = await tmpRoot();
  const deck = await seedCachedDeck(repoRoot, 'Conditional deck');

  const first = await getThumbnail(repoRoot, deck.id);
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers.ETag, deck.etag, 'the raster is tagged');
  assert.equal(
    first.headers['Cache-Control'],
    'private, no-cache',
    'the browser must revalidate — the URL no longer carries a buster',
  );

  const second = await getThumbnail(repoRoot, deck.id, {
    'if-none-match': first.headers.ETag,
  });
  assert.equal(second.statusCode, 304);
  assert.equal(second.body, undefined, '304 carries no body');
  assert.equal(second.headers.ETag, deck.etag, '304 repeats the tag');
  assert.equal(second.headers['Cache-Control'], 'private, no-cache');
});

test('a request holding a different ETag gets the bytes', async () => {
  const repoRoot = await tmpRoot();
  const deck = await seedCachedDeck(repoRoot, 'Changed deck');

  const res = await getThumbnail(repoRoot, deck.id, {
    'if-none-match': '"some-other-deck-0000000000000000.webp"',
  });
  assert.equal(res.statusCode, 200, 'a stale tag must not short-circuit');
  assert.ok(res.body.equals(deck.webp));
});

test('If-None-Match matches inside a list and ignores the weak prefix', async () => {
  const repoRoot = await tmpRoot();
  const deck = await seedCachedDeck(repoRoot, 'List-header deck');

  const inList = await getThumbnail(repoRoot, deck.id, {
    'if-none-match': `"other.webp", ${deck.etag}`,
  });
  assert.equal(inList.statusCode, 304, 'any member of the list may match');

  const weak = await getThumbnail(repoRoot, deck.id, {
    'if-none-match': `W/${deck.etag}`,
  });
  assert.equal(weak.statusCode, 304, 'a conditional GET compares weakly');
});

test('route denies a non-owner on a private deck', async () => {
  const repoRoot = await tmpRoot();
  const created = await createPresentation(testScope(), {
    title: 'Private deck',
    ownerEmail: 'owner@example.com',
    visibility: 'private',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
  });

  const res = mockRes();
  await handlePresentationThumbnail(
    {
      repoRoot,
      storageScope: testScope(),
      req: { method: 'GET' },
      res,
      authedUser: { email: 'intruder@example.com' },
    },
    created.id,
  );
  assert.equal(
    res.statusCode,
    403,
    'private deck thumbnails require read access',
  );
});

test('route 404s for an unknown deck', async () => {
  const repoRoot = await tmpRoot();
  const res = mockRes();
  await handlePresentationThumbnail(
    {
      repoRoot,
      storageScope: testScope(),
      req: { method: 'GET' },
      res,
      authedUser: sessionFor('owner@example.com'),
    },
    'does-not-exist',
  );
  assert.equal(res.statusCode, 404);
});

test('route rejects non-GET methods', async () => {
  const repoRoot = await tmpRoot();
  const res = mockRes();
  await handlePresentationThumbnail(
    {
      repoRoot,
      storageScope: testScope(),
      req: { method: 'POST' },
      res,
      authedUser: { email: 'x@example.com' },
    },
    'whatever',
  );
  assert.equal(res.statusCode, 405);
});

// ── Stale-while-revalidate + pruning ────────────────────────────────────────

test('readStaleThumbnail returns the newest other raster for the same deck', async () => {
  const repoRoot = await tmpRoot();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(
    path.join(dir, 'deck1-aaaaaaaaaaaaaaaa.webp'),
    Buffer.from('old'),
  );
  await fs.writeFile(
    path.join(dir, 'deck1-bbbbbbbbbbbbbbbb.webp'),
    Buffer.from('newer'),
  );
  // Make the ordering unambiguous regardless of filesystem timestamp resolution.
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(path.join(dir, 'deck1-aaaaaaaaaaaaaaaa.webp'), past, past);
  // A different deck must never be borrowed from.
  await fs.writeFile(
    path.join(dir, 'deck2-cccccccccccccccc.webp'),
    Buffer.from('other deck'),
  );

  const stale = await readStaleThumbnail(repoRoot, 'deck1', 'deck1-fresh.webp');
  assert.ok(stale, 'found a previous raster');
  assert.equal(stale.buffer.toString(), 'newer');

  // The key we are waiting on is never offered back as its own stale fallback.
  const self = await readStaleThumbnail(
    repoRoot,
    'deck1',
    'deck1-bbbbbbbbbbbbbbbb.webp',
  );
  assert.equal(self.buffer.toString(), 'old');

  assert.equal(await readStaleThumbnail(repoRoot, 'deck-none', 'x.webp'), null);
});

test('pruneDeckThumbnails keeps only the current raster for that deck', async () => {
  const repoRoot = await tmpRoot();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'deck1-keep.webp'), Buffer.from('keep'));
  await fs.writeFile(path.join(dir, 'deck1-old1.webp'), Buffer.from('drop'));
  await fs.writeFile(path.join(dir, 'deck1-old2.webp'), Buffer.from('drop'));
  await fs.writeFile(
    path.join(dir, 'deck2-other.webp'),
    Buffer.from('untouched'),
  );

  await pruneDeckThumbnails(repoRoot, 'deck1', { keep: 'deck1-keep.webp' });

  const left = (await fs.readdir(dir)).sort();
  assert.deepEqual(left, ['deck1-keep.webp', 'deck2-other.webp']);
});

test('pruneDeckThumbnails without a keep drops every raster for that deck', async () => {
  const repoRoot = await tmpRoot();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'deck1-a.webp'), Buffer.from('gone'));
  await fs.writeFile(path.join(dir, 'deck1-b.webp'), Buffer.from('gone'));
  await fs.writeFile(
    path.join(dir, 'deck2-other.webp'),
    Buffer.from('untouched'),
  );

  await pruneDeckThumbnails(repoRoot, 'deck1');

  assert.deepEqual(await fs.readdir(dir), ['deck2-other.webp']);
});

test('pruneDeckThumbnails sanitizes the deck id into the cache prefix', async () => {
  const repoRoot = await tmpRoot();
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  // Same sanitization the cache key applies when it writes the file.
  const { prefix } = thumbCacheKey({ id: 'deck/../weird id' }, null);
  await fs.writeFile(path.join(dir, `${prefix}-x.webp`), Buffer.from('gone'));

  await pruneDeckThumbnails(repoRoot, 'deck/../weird id');

  assert.deepEqual(await fs.readdir(dir), []);
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
    visibility: 'private',
    slides: [],
  });
  const seeded = await getPresentation(testScope(), created.id);
  await updatePresentation(
    testScope(),
    created.id,
    { ...seeded, slides: [] },
    {
      expectedRevision: seeded.revision,
    },
  );
  const pres = await getPresentation(testScope(), created.id);
  const theme = await loadThemeAssets(repoRoot, pres.theme);
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
    {
      repoRoot,
      storageScope: testScope(),
      req: { method: 'GET' },
      res,
      authedUser: sessionFor('owner@example.com'),
    },
    created.id,
  );
  assert.equal(res.statusCode, 200, 'stale beats a placeholder');
  assert.equal(res.headers['Content-Type'], 'image/webp');
  assert.ok(res.body.equals(webp));
  assert.equal(
    res.headers.ETag,
    `"${prefix}-0000000000000000.webp"`,
    'the stale raster is tagged with its own name, not the fresh key — a 304 ' +
      'must never present a one-edit-old raster as the current one',
  );
});

// ── Deleting a deck takes its rasters with it ───────────────────────────────

test("a permanent delete removes the deck's cached rasters", async () => {
  const repoRoot = await tmpRoot();
  const created = await createPresentation(testScope(), {
    title: 'Doomed deck',
    ownerEmail: 'owner@example.com',
    visibility: 'private',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Bye' } }],
  });
  const pres = await getPresentation(testScope(), created.id);
  const theme = await loadThemeAssets(repoRoot, pres.theme);
  const { prefix, filename } = thumbCacheKey(pres, theme);

  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), Buffer.from('current'));
  // A raster from an earlier slide-1 state is just as orphaned.
  await fs.writeFile(
    path.join(dir, `${prefix}-0000000000000000.webp`),
    Buffer.from('previous'),
  );
  await fs.writeFile(path.join(dir, 'other-deck-x.webp'), Buffer.from('keep'));

  // Trashing is not the end of a deck: its card still shows a thumbnail, and a
  // restore must not come back blank.
  await deletePresentation(testScope(), created.id, {
    actorEmail: 'owner@example.com',
  });
  assert.equal(
    (await fs.readdir(dir)).length,
    3,
    'the trash keeps the rasters',
  );

  const res = mockRes();
  await handlePresentationPermanentDelete(
    {
      repoRoot,
      storageScope: testScope(),
      req: { method: 'DELETE' },
      res,
      authedUser: sessionFor('owner@example.com'),
    },
    created.id,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    await fs.readdir(dir),
    ['other-deck-x.webp'],
    "every raster for the deleted deck is gone, nobody else's is",
  );
});
