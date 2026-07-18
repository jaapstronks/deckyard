/**
 * Per-user slide-library usage storage round-trip.
 *
 * Drives the storage facade (server/storage/slide-library-usage.js) against an
 * initialized file adapter - the same path the running server uses in default
 * OSS (file) mode. Covers:
 * - recording slide + collection usage and reading back the used set
 * - de-duplication of a repeated ref within one call (single row)
 * - useCount increment + firstUsedAt stability across calls
 * - per-user isolation (one user's usage is invisible to another)
 * - input hygiene (invalid types / blank ids / non-array are ignored)
 *
 * Run with: node --test tests/slide-library-usage-storage.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = path.join(os.tmpdir(), `deckyard-usage-${crypto.randomUUID()}`);
process.env.DATA_DIR = path.join(repoRoot, 'data');

const { initializeStorage, closeStorage } = await import('../server/storage/adapters/index.js');
const { listSlideLibraryUsage, recordSlideLibraryUsage } = await import(
  '../server/storage/slide-library-usage.js'
);

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

const keyOf = (u) => `${u.itemType}:${u.itemId}`;
const usedSet = async (email) => {
  const { items } = await listSlideLibraryUsage(repoRoot, email);
  return new Set(items.map(keyOf));
};

before(async () => {
  await fs.mkdir(process.env.DATA_DIR, { recursive: true });
  await initializeStorage(repoRoot);
});

after(async () => {
  await closeStorage();
  await fs.rm(repoRoot, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('slide-library usage', () => {
  it('records slide + collection usage and reads back the used set', async () => {
    const r = await recordSlideLibraryUsage(repoRoot, ALICE, [
      { type: 'slide', id: 's1' },
      { type: 'collection', id: 'c1' },
    ]);
    assert.ok(r.ok);
    assert.strictEqual(r.recorded, 2);

    const used = await usedSet(ALICE);
    assert.ok(used.has('slide:s1'));
    assert.ok(used.has('collection:c1'));
    assert.strictEqual(used.size, 2);
  });

  it('de-duplicates a repeated ref within one call', async () => {
    await recordSlideLibraryUsage(repoRoot, ALICE, [
      { type: 'slide', id: 'dup' },
      { type: 'slide', id: 'dup' },
    ]);
    const { items } = await listSlideLibraryUsage(repoRoot, ALICE);
    const rows = items.filter((u) => keyOf(u) === 'slide:dup');
    assert.strictEqual(rows.length, 1, 'one row for the deduped ref');
    assert.strictEqual(rows[0].useCount, 1);
  });

  it('increments useCount and keeps firstUsedAt on repeat use', async () => {
    await recordSlideLibraryUsage(repoRoot, ALICE, [{ type: 'slide', id: 'repeat' }]);
    const first = (await listSlideLibraryUsage(repoRoot, ALICE)).items.find(
      (u) => keyOf(u) === 'slide:repeat'
    );
    assert.strictEqual(first.useCount, 1);

    await recordSlideLibraryUsage(repoRoot, ALICE, [{ type: 'slide', id: 'repeat' }]);
    const second = (await listSlideLibraryUsage(repoRoot, ALICE)).items.find(
      (u) => keyOf(u) === 'slide:repeat'
    );
    assert.strictEqual(second.useCount, 2);
    assert.strictEqual(second.firstUsedAt, first.firstUsedAt, 'firstUsedAt is stable');
  });

  it('isolates usage between users', async () => {
    await recordSlideLibraryUsage(repoRoot, BOB, [{ type: 'slide', id: 'bob-only' }]);
    const aliceUsed = await usedSet(ALICE);
    const bobUsed = await usedSet(BOB);
    assert.ok(bobUsed.has('slide:bob-only'));
    assert.ok(!aliceUsed.has('slide:bob-only'), "Alice can't see Bob's usage");
  });

  it('ignores invalid types, blank ids, and non-array input', async () => {
    const before = (await usedSet(ALICE)).size;
    const r = await recordSlideLibraryUsage(repoRoot, ALICE, [
      { type: 'bogus', id: 'x' },
      { type: 'slide', id: '   ' },
      { type: 'slide' },
      null,
    ]);
    assert.strictEqual(r.recorded, 0);

    const r2 = await recordSlideLibraryUsage(repoRoot, ALICE, 'not-an-array');
    assert.strictEqual(r2.recorded, 0);

    assert.strictEqual((await usedSet(ALICE)).size, before, 'nothing recorded');
  });

  it('returns an empty set for a user with no usage', async () => {
    const { items } = await listSlideLibraryUsage(repoRoot, 'nobody@example.com');
    assert.deepStrictEqual(items, []);
  });
});
