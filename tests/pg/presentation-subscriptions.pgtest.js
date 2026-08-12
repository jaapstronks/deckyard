/**
 * `setSubscription` against real PostgreSQL.
 *
 * Per-deck notification overrides (server/storage/presentation-subscriptions.js)
 * upsert with ON CONFLICT (presentation_id, user_email) DO UPDATE SET level.
 * The conflict target is the table's composite PRIMARY KEY (migration 044),
 * and `presentation_id` is a NOT NULL FK to `presentations(id)` — so a real
 * database enforces both that the parent deck exists and that a second set for
 * the same (deck, user) changes the level in place rather than adding a row.
 * The double models neither the FK nor the composite key.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  getSubscription,
  listSubscriptions,
  setSubscription,
} from '../../server/storage/presentation-subscriptions.js';

const ctx = testScope();
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

pgDescribe('setSubscription (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let pid;

  const countRows = async () => {
    const row = await db
      .selectFrom('presentation_subscriptions')
      .select(db.fn.countAll().as('n'))
      .where('presentation_id', '=', pid)
      .executeTakeFirst();
    return Number(row.n);
  };

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    pid = await seedPresentation(db);
  });

  it('inserts an override on the first set', async () => {
    const res = await setSubscription(ctx, pid, ALICE, 'watching');
    assert.equal(res.ok, true);
    assert.equal(res.level, 'watching');

    const got = await getSubscription(ctx, pid, ALICE);
    assert.equal(got.level, 'watching');
    assert.equal(await countRows(), 1);
  });

  it('updates the level in place on the (presentation_id, user_email) conflict', async () => {
    await setSubscription(ctx, pid, ALICE, 'watching');
    const res = await setSubscription(ctx, pid, ALICE, 'mute');
    assert.equal(res.ok, true);
    assert.equal(res.level, 'mute');

    const got = await getSubscription(ctx, pid, ALICE);
    assert.equal(got.level, 'mute');
    assert.equal(await countRows(), 1, 'exactly one override per (deck, user)');
  });

  it('clears an override with a null level', async () => {
    await setSubscription(ctx, pid, ALICE, 'watching');
    const res = await setSubscription(ctx, pid, ALICE, null);
    assert.equal(res.ok, true);
    assert.equal(res.level, null);

    assert.equal(await getSubscription(ctx, pid, ALICE), null);
    assert.equal(await countRows(), 0);
  });

  it('rejects an unknown level without writing', async () => {
    const res = await setSubscription(ctx, pid, ALICE, 'nonsense');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid_level');
    assert.equal(await countRows(), 0);
  });

  it('keeps per-user overrides distinct and lists them as a map', async () => {
    await setSubscription(ctx, pid, ALICE, 'watching');
    await setSubscription(ctx, pid, BOB, 'mentions_only');

    const map = await listSubscriptions(ctx, pid);
    assert.equal(map.get(ALICE), 'watching');
    assert.equal(map.get(BOB), 'mentions_only');
    assert.equal(map.size, 2);
  });
});
