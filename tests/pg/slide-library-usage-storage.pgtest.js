/**
 * Per-user slide-library usage against real PostgreSQL, through the facade.
 *
 * The PostgreSQL counterpart of tests/slide-library-usage-storage.test.js. Same
 * facade (server/storage/slide-library-usage.js), same round-trip:
 * - recording slide + collection usage and reading back the used set
 * - de-duplication of a repeated ref within one call (single row)
 * - useCount increment + firstUsedAt stability across calls
 * - per-user isolation
 * - input hygiene (invalid types / blank ids / non-array are ignored)
 *
 * The increment path is the point of running it here: the adapter upserts with
 * `ON CONFLICT (…) DO UPDATE SET use_count = use_count + 1`
 * (postgres/slide-library-usage.js) — one of the conflict shapes the in-memory
 * double only approximates. `item_id` is a bare varchar (no FK), so no
 * slide-library rows are needed; only the owning organization is seeded.
 */

import { after, before, it } from 'node:test';
import assert from 'node:assert';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  listSlideLibraryUsage,
  recordSlideLibraryUsage,
} from '../../server/storage/slide-library-usage.js';

const storageScope = testScope();
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

const keyOf = (u) => `${u.itemType}:${u.itemId}`;

pgDescribe('slide-library usage (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  const usedSet = async (email) => {
    const { items } = await listSlideLibraryUsage(storageScope, email);
    return new Set(items.map(keyOf));
  };

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('records slide + collection usage and reads back the used set', async () => {
    const r = await recordSlideLibraryUsage(storageScope, ALICE, [
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
    await recordSlideLibraryUsage(storageScope, ALICE, [
      { type: 'slide', id: 'dup' },
      { type: 'slide', id: 'dup' },
    ]);
    const { items } = await listSlideLibraryUsage(storageScope, ALICE);
    const rows = items.filter((u) => keyOf(u) === 'slide:dup');
    assert.strictEqual(rows.length, 1, 'one row for the deduped ref');
    assert.strictEqual(rows[0].useCount, 1);
  });

  it('increments useCount and keeps firstUsedAt on repeat use', async () => {
    await recordSlideLibraryUsage(storageScope, ALICE, [
      { type: 'slide', id: 'repeat' },
    ]);
    const first = (await listSlideLibraryUsage(storageScope, ALICE)).items.find(
      (u) => keyOf(u) === 'slide:repeat',
    );
    assert.strictEqual(first.useCount, 1);

    await recordSlideLibraryUsage(storageScope, ALICE, [
      { type: 'slide', id: 'repeat' },
    ]);
    const second = (
      await listSlideLibraryUsage(storageScope, ALICE)
    ).items.find((u) => keyOf(u) === 'slide:repeat');
    assert.strictEqual(second.useCount, 2);
    assert.strictEqual(
      second.firstUsedAt,
      first.firstUsedAt,
      'firstUsedAt is stable',
    );
  });

  it('isolates usage between users', async () => {
    await recordSlideLibraryUsage(storageScope, BOB, [
      { type: 'slide', id: 'bob-only' },
    ]);
    const aliceUsed = await usedSet(ALICE);
    const bobUsed = await usedSet(BOB);
    assert.ok(bobUsed.has('slide:bob-only'));
    assert.ok(!aliceUsed.has('slide:bob-only'), "Alice can't see Bob's usage");
  });

  it('ignores invalid types, blank ids, and non-array input', async () => {
    const before = (await usedSet(ALICE)).size;
    const r = await recordSlideLibraryUsage(storageScope, ALICE, [
      { type: 'bogus', id: 'x' },
      { type: 'slide', id: '   ' },
      { type: 'slide' },
      null,
    ]);
    assert.strictEqual(r.recorded, 0);

    const r2 = await recordSlideLibraryUsage(
      storageScope,
      ALICE,
      'not-an-array',
    );
    assert.strictEqual(r2.recorded, 0);

    assert.strictEqual((await usedSet(ALICE)).size, before, 'nothing recorded');
  });

  it('returns an empty set for a user with no usage', async () => {
    const { items } = await listSlideLibraryUsage(
      storageScope,
      'nobody@example.com',
    );
    assert.deepStrictEqual(items, []);
  });
});
