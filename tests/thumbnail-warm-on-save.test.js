/**
 * Warming the deck-grid thumbnail on save (the rest of A0.6, after PR #422).
 *
 * PR #422 made a slide-1 edit cheap to detect (the cache key is slide 1 + theme,
 * not the deck revision) and stopped the card from flashing a placeholder. What
 * it left out was warming on *save*, because an unthrottled warm puts a
 * headless-Chrome render on the autosave path — measured at the time as the test
 * suite going from ~10s to >10 minutes.
 *
 * So the throttling *is* the feature, and it is what these tests cover:
 *
 * - a burst of saves collapses into one warm (per deck);
 * - a save that did not touch slide 1 schedules nothing at all;
 * - the PUT route wires both of those in;
 * - warming is off by default under `node --test`, so this suite can never
 *   grow a Chrome render.
 *
 * The renders themselves are never run here: the queue is exercised with stub
 * tasks, and `warmDeckThumbnail`'s rasterization is the same
 * `requestThumbnailGeneration` path that tests/deck-thumbnail.test.js and the
 * PNG-export tests already cover.
 *
 * Run with: node --test tests/thumbnail-warm-on-save.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  scheduleThumbnailWarm,
  pendingWarmKeys,
  cancelPendingWarms,
  flushPendingWarms,
  warmOnSaveEnabled,
  WARM_DEBOUNCE_MS,
} from '../server/render/thumbnail-warm-queue.js';
import { scheduleDeckThumbnailWarm } from '../server/routes/api/presentations/thumbnail.js';
import {
  thumbCacheKey,
  firstSlideSignature,
  readCachedThumbnail,
} from '../server/render/deck-thumbnail.js';
import { handlePresentationItem } from '../server/routes/api/presentations/presentation.js';
import { handlePresentationThumbnail } from '../server/routes/api/presentations/thumbnail.js';
import { loadTheme } from '../server/utils/themes.js';
import { dataDir } from '../server/config/storage-paths.js';
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

const OWNER = 'owner@example.com';
const owner = { email: OWNER, isAdmin: false };

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/**
 * A throwaway root for the on-disk raster cache (`dataDir(root)/deck-thumbs`).
 * Decks themselves live in the database double, not under this root.
 */
async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-warm-'));
}

// Stable ids: the storage layer validates slide ids as UUIDs, and the cache key
// hashes the whole slide — so a fresh id per call would look like an edit.
const SLIDE_1 = randomUUID();
const SLIDE_2 = randomUUID();
const SLIDE_0 = randomUUID();

const slide = (title, id = SLIDE_1) => ({
  id,
  type: 'content-slide',
  content: { title, body: `Body of ${title}` },
});

/** Enable warming for a single test, always restoring the previous value. */
async function withWarmingEnabled(fn) {
  const previous = process.env.DECK_THUMBNAIL_WARM_ON_SAVE;
  process.env.DECK_THUMBNAIL_WARM_ON_SAVE = '1';
  try {
    return await fn();
  } finally {
    cancelPendingWarms();
    if (previous === undefined) delete process.env.DECK_THUMBNAIL_WARM_ON_SAVE;
    else process.env.DECK_THUMBNAIL_WARM_ON_SAVE = previous;
  }
}

function fakeReq({ method = 'PUT', headers = {}, body = null } = {}) {
  const buf = Buffer.from(body == null ? '' : JSON.stringify(body), 'utf8');
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

// ── The kill switch ─────────────────────────────────────────────────────────

test('warming is off by default under the node test runner', () => {
  const previous = process.env.DECK_THUMBNAIL_WARM_ON_SAVE;
  delete process.env.DECK_THUMBNAIL_WARM_ON_SAVE;
  try {
    // Guards the whole suite: without this, every test that saves a deck would
    // queue a headless-Chrome render. That is the regression that got the first
    // attempt at this feature reverted.
    assert.equal(process.env.NODE_TEST_CONTEXT ? warmOnSaveEnabled() : false, false);

    let ran = 0;
    assert.equal(
      scheduleThumbnailWarm('deck-off', () => { ran++; }, { delayMs: 1 }),
      false,
      'scheduling reports that nothing was queued'
    );
    assert.deepEqual(pendingWarmKeys(), [], 'and nothing is pending');
    assert.equal(ran, 0);
  } finally {
    if (previous === undefined) delete process.env.DECK_THUMBNAIL_WARM_ON_SAVE;
    else process.env.DECK_THUMBNAIL_WARM_ON_SAVE = previous;
  }
});

test('the env flag overrides in both directions', () => {
  const previous = process.env.DECK_THUMBNAIL_WARM_ON_SAVE;
  try {
    process.env.DECK_THUMBNAIL_WARM_ON_SAVE = '1';
    assert.equal(warmOnSaveEnabled(), true);
    process.env.DECK_THUMBNAIL_WARM_ON_SAVE = '0';
    assert.equal(warmOnSaveEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.DECK_THUMBNAIL_WARM_ON_SAVE;
    else process.env.DECK_THUMBNAIL_WARM_ON_SAVE = previous;
  }
});

test('the debounce window outlasts the editor autosave interval', () => {
  // The editor autosaves 1500ms after the last keystroke
  // (client/views/editor/save-manager.js). A window at or below that would let
  // continuous typing fire a render per save — the exact failure being avoided.
  assert.ok(WARM_DEBOUNCE_MS > 1500, 'a typing burst must not out-tick the debounce');
});

// ── The debounce ────────────────────────────────────────────────────────────

test('a burst of saves collapses into one warm', async () => {
  await withWarmingEnabled(async () => {
    let runs = 0;
    for (let i = 0; i < 8; i++) {
      scheduleThumbnailWarm('deck-burst', async () => { runs++; }, { delayMs: 20 });
    }
    assert.deepEqual(pendingWarmKeys(), ['deck-burst'], 'one pending warm, not eight');

    await flushPendingWarms();
    assert.equal(runs, 1, 'eight saves cost one render, not eight');
    assert.deepEqual(pendingWarmKeys(), [], 'the queue empties once it has run');
  });
});

test('the last save in a burst is the one that gets rendered', async () => {
  await withWarmingEnabled(async () => {
    const rendered = [];
    for (const title of ['first', 'second', 'third']) {
      scheduleThumbnailWarm('deck-latest', async () => { rendered.push(title); }, { delayMs: 20 });
    }
    await flushPendingWarms();
    assert.deepEqual(rendered, ['third'], 'the card must not show a superseded edit');
  });
});

test('decks are debounced independently', async () => {
  await withWarmingEnabled(async () => {
    const runs = [];
    scheduleThumbnailWarm('deck-a', async () => { runs.push('a'); }, { delayMs: 20 });
    scheduleThumbnailWarm('deck-b', async () => { runs.push('b'); }, { delayMs: 20 });
    scheduleThumbnailWarm('deck-a', async () => { runs.push('a2'); }, { delayMs: 20 });

    assert.deepEqual(pendingWarmKeys().sort(), ['deck-a', 'deck-b']);
    await flushPendingWarms();
    assert.deepEqual(runs.sort(), ['a2', 'b'], 'one warm each, neither swallowed the other');
  });
});

test('a failing warm never escapes the queue', async () => {
  await withWarmingEnabled(async () => {
    scheduleThumbnailWarm('deck-boom', async () => {
      throw new Error('no chrome here');
    }, { delayMs: 20 });
    await flushPendingWarms(); // rejects → the test fails; swallowed → it passes
    assert.deepEqual(pendingWarmKeys(), []);
  });
});

test('a pending warm cannot keep the process alive', async () => {
  await withWarmingEnabled(async () => {
    scheduleThumbnailWarm('deck-unref', async () => {}, { delayMs: 60_000 });
    assert.deepEqual(pendingWarmKeys(), ['deck-unref']);
    // If the timer were ref'd, this suite would sit here for a minute at exit.
  });
});

// ── The "did slide 1 change?" gate ───────────────────────────────────────────

test('a save that leaves slide 1 alone schedules nothing', async () => {
  await withWarmingEnabled(async () => {
    const before = {
      id: 'deck-1',
      slides: [slide('Cover'), slide('Old', SLIDE_2)],
    };
    const after = {
      id: 'deck-1',
      revision: 2,
      slides: [slide('Cover'), slide('New', SLIDE_2)],
    };
    assert.equal(
      firstSlideSignature(before),
      firstSlideSignature(after),
      'the raster inputs are untouched'
    );
    assert.equal(scheduleDeckThumbnailWarm({ repoRoot: '/tmp', before, after }), false);
    assert.deepEqual(pendingWarmKeys(), [], 'most saves stay free');
  });
});

test('a save that changes slide 1 schedules exactly one warm for that deck', async () => {
  await withWarmingEnabled(async () => {
    const before = { id: 'deck-2', slides: [slide('Cover')] };
    const after = { id: 'deck-2', revision: 2, slides: [slide('Cover, revised')] };
    assert.equal(scheduleDeckThumbnailWarm({ repoRoot: '/tmp', before, after }), true);
    scheduleDeckThumbnailWarm({ repoRoot: '/tmp', before, after });
    assert.deepEqual(pendingWarmKeys(), ['deck-2']);
  });
});

test('adding a slide in front of the deck counts as changing slide 1', async () => {
  await withWarmingEnabled(async () => {
    const before = { id: 'deck-3', slides: [slide('Cover')] };
    const after = {
      id: 'deck-3',
      slides: [slide('New cover', SLIDE_0), slide('Cover')],
    };
    assert.equal(scheduleDeckThumbnailWarm({ repoRoot: '/tmp', before, after }), true);
  });
});

// ── The save route ──────────────────────────────────────────────────────────

test('PUT wires the gate in: slide 1 edited → warm pending, otherwise → nothing', async () => {
  const repoRoot = await tmpRoot();
  const storageScope = testScope();

  await withWarmingEnabled(async () => {
    const created = await createPresentation(storageScope, {
      title: 'Deck',
      ownerEmail: OWNER,
      slides: [slide('Cover'), slide('Body', SLIDE_2)],
    });

    // A save that only touches slide 2.
    const res1 = fakeRes();
    await handlePresentationItem(
      {
        repoRoot,
        storageScope,
        req: fakeReq({
          headers: { 'if-match': String(created.revision) },
          // Slide 1 sent back exactly as stored — this is a slide-2-only save.
          body: { ...created, slides: [created.slides[0], slide('Edited', SLIDE_2)] },
        }),
        res: res1,
        url: `/api/presentations/${created.id}`,
        authedUser: owner,
      },
      created.id
    );
    assert.equal(res1.statusCode, 200, 'the save itself succeeded');
    assert.deepEqual(pendingWarmKeys(), [], 'no render queued for a slide the card never shows');

    // A save that touches slide 1.
    const current = await getPresentation(storageScope, created.id);
    const res2 = fakeRes();
    await handlePresentationItem(
      {
        repoRoot,
        storageScope,
        req: fakeReq({
          headers: { 'if-match': String(current.revision) },
          body: { ...current, slides: [slide('Cover, revised'), current.slides[1]] },
        }),
        res: res2,
        url: `/api/presentations/${created.id}`,
        authedUser: owner,
      },
      created.id
    );
    assert.equal(res2.statusCode, 200);
    assert.deepEqual(pendingWarmKeys(), [created.id], 'the raster is queued for a re-render');
  });

  await fs.rm(repoRoot, { recursive: true, force: true });
});

// ── What the warm buys the next Home load ───────────────────────────────────

test('after the warm ran, the next Home load is a cache hit instead of a miss', async () => {
  const repoRoot = await tmpRoot();
  const storageScope = testScope();

  await withWarmingEnabled(async () => {
    const created = await createPresentation(storageScope, {
      title: 'Deck',
      ownerEmail: OWNER,
      slides: [slide('Cover')],
    });

    const before = await getPresentation(storageScope, created.id);
    const updated = await updatePresentation(
      storageScope,
      created.id,
      { ...before, slides: [slide('Cover, revised')] },
      { expectedRevision: before.revision, actorEmail: OWNER }
    );

    const theme = await loadTheme(repoRoot, updated.theme);
    const { filename } = thumbCacheKey(updated, theme);

    // No warm yet: the next Home load misses, so it serves the previous raster
    // and has to kick off the render itself.
    assert.equal(
      await readCachedThumbnail(repoRoot, filename),
      null,
      'the edited slide 1 has no raster yet'
    );

    // Stand in for warmDeckThumbnail: it resolves the same key and writes the
    // same file — the rasterization itself is covered by the generation tests.
    scheduleDeckThumbnailWarm({ repoRoot, before, after: updated, authedUser: owner });
    assert.deepEqual(pendingWarmKeys(), [created.id]);
    cancelPendingWarms();

    const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
    await fs.mkdir(dir, { recursive: true });
    scheduleThumbnailWarm(
      created.id,
      () => fs.writeFile(path.join(dir, filename), Buffer.from('fresh-raster')),
      { delayMs: 20 }
    );
    await flushPendingWarms();

    // Now the Home load is a plain cache hit: the fresh bytes, and a long
    // max-age instead of the 10s revalidate window a stale serve gets.
    const res = fakeRes();
    await handlePresentationThumbnail(
      { repoRoot, storageScope, req: { method: 'GET' }, res, authedUser: owner },
      created.id
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.toString(), 'fresh-raster', 'the card shows the edit, not the old cover');
    assert.equal(res.headers['Cache-Control'], 'public, max-age=3600', 'served as fresh');
  });

  await fs.rm(repoRoot, { recursive: true, force: true });
});
