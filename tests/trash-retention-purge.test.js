/**
 * The trash keeps its promise (B330).
 *
 * The trash page has always said a deck is deleted after the retention window;
 * nothing deleted it. These tests pin the sweep that now does, and — more
 * importantly — pin that it is *the same* deletion the "Delete permanently"
 * button performs. That is the whole design: one seam
 * (`server/services/permanent-delete.js`), two callers. A test that only
 * checked "the row is gone" would pass while the sweep quietly left every
 * raster on disk, which is the divergence the seam exists to prevent.
 *
 * Covered: past the window, inside it, exactly on the boundary, restored before
 * the window, a repeated run, the organization scope, the rasters, and the
 * refusal to erase a deck that was never trashed.
 *
 * Run with: node --test tests/trash-retention-purge.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { dataDir } from '../server/config/storage-paths.js';
import { testScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const {
  createPresentation,
  getPresentation,
  deletePresentation,
  restorePresentation,
} = await import('../server/storage/presentations/index.js');
const { permanentlyDeletePresentation } =
  await import('../server/services/permanent-delete.js');
const { runRetentionCleanup } =
  await import('../server/jobs/retention-cleanup.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgoIso = (n) => new Date(Date.now() - n * DAY_MS).toISOString();

let repoRoot;
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: userRows('owner@example.com'),
  });
  __setTestDb(db);
  await initializeStorage();
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trash-retention-'));
});

test.after(async () => {
  __setTestDb(null);
  __resetStorageForTests?.();
  if (repoRoot) await fs.rm(repoRoot, { recursive: true, force: true });
});

/** Create a deck, trash it, and backdate the trashing by `days`. */
async function trashedDeck(title, days, { organizationId = ORG } = {}) {
  const scope = { ...testScope(), organizationId, repoRoot };
  const created = await createPresentation(scope, {
    title,
    ownerEmail: 'owner@example.com',
  });
  await deletePresentation(scope, created.id, {
    actorEmail: 'owner@example.com',
  });
  if (days != null) {
    // Backdate the trashing: the sweep reads `trashed_at`, and a test cannot
    // wait 30 days for it.
    const row = db.__tables.presentations.find((r) => r.id === created.id);
    row.trashed_at = daysAgoIso(days);
  }
  return created.id;
}

/** Write a fake raster for a deck into the thumbnail cache. */
async function writeThumb(id) {
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}-abc.webp`);
  await fs.writeFile(file, 'not-really-a-webp');
  return file;
}

async function thumbsFor(id) {
  const dir = path.join(dataDir(repoRoot), 'deck-thumbs');
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.filter((name) => name.startsWith(`${id}-`));
}

test('the sweep purges a deck past the window and leaves one inside it', async () => {
  const old = await trashedDeck('Past the window', 45);
  const fresh = await trashedDeck('Inside the window', 10);

  const result = await runRetentionCleanup({
    repoRoot,
    trashRetentionDays: 30,
  });

  assert.equal(result.trashedDecks, 1);
  assert.equal(await getPresentation(testScope(), old), null);
  assert.ok(await getPresentation(testScope(), fresh));
});

test('a deck trashed exactly on the boundary is due', async () => {
  const boundary = await trashedDeck('On the boundary', 30);

  const result = await runRetentionCleanup({
    repoRoot,
    trashRetentionDays: 30,
  });

  assert.equal(result.trashedDecks, 1);
  assert.equal(await getPresentation(testScope(), boundary), null);
});

test('restoring before the window saves the deck for good', async () => {
  const id = await trashedDeck('Restored in time', 45);
  const restored = await restorePresentation(testScope(), id);
  assert.equal(restored.ok, true);

  const result = await runRetentionCleanup({
    repoRoot,
    trashRetentionDays: 30,
  });

  assert.equal(result.trashedDecks, 0);
  assert.ok(await getPresentation(testScope(), id));
});

test('a repeated run purges nothing the first one already took', async () => {
  await trashedDeck('Purged once', 45);

  const first = await runRetentionCleanup({ repoRoot, trashRetentionDays: 30 });
  const second = await runRetentionCleanup({
    repoRoot,
    trashRetentionDays: 30,
  });

  assert.equal(first.trashedDecks, 1);
  assert.equal(second.trashedDecks, 0);
});

test('the sweep reaches every organization, and purges each in its own scope', async () => {
  const mine = await trashedDeck('Mine', 45);
  const theirs = await trashedDeck('Theirs', 45, { organizationId: OTHER_ORG });

  const result = await runRetentionCleanup({
    repoRoot,
    trashRetentionDays: 30,
  });

  assert.equal(result.trashedDecks, 2);
  assert.equal(await getPresentation(testScope(), mine), null);
  // Read it back through its *own* organization: gone there too, and the
  // organization it never belonged to could not have reached it.
  assert.equal(
    await getPresentation(
      { ...testScope(), organizationId: OTHER_ORG },
      theirs,
    ),
    null,
  );
});

test('the sweep takes the rasters with it, exactly like the button', async () => {
  const swept = await trashedDeck('Swept', 45);
  const pressed = await trashedDeck('Button', 45);
  await writeThumb(swept);
  await writeThumb(pressed);

  // The button: straight through the seam the route calls.
  await permanentlyDeletePresentation({
    repoRoot,
    storageScope: testScope(),
    id: pressed,
  });
  assert.deepEqual(await thumbsFor(pressed), []);

  // The sweep: the same seam, so the same disk afterwards.
  await runRetentionCleanup({ repoRoot, trashRetentionDays: 30 });
  assert.deepEqual(await thumbsFor(swept), []);
});

test('the seam refuses a deck that is not in the trash', async () => {
  const live = await createPresentation(
    { ...testScope(), repoRoot },
    { title: 'Still in use', ownerEmail: 'owner@example.com' },
  );

  const result = await permanentlyDeletePresentation({
    repoRoot,
    storageScope: testScope(),
    id: live.id,
  });

  assert.deepEqual(result, { ok: false, reason: 'not_trashed' });
  assert.ok(await getPresentation(testScope(), live.id));
});
