/**
 * `incrementUsage` against real PostgreSQL.
 *
 * The upsert here sets each counter to `COALESCE(<col>, 0) + n` inside the
 * `DO UPDATE` (server/storage/api-usage.js). The in-memory double only models
 * the plain `<col> ± <n>` shape, so a `COALESCE`-wrapped increment is exactly
 * the kind of query it approximates rather than runs. This exercises it on the
 * database that actually evaluates it, across the insert path and the
 * conflict path on the `(api_key_id, date)` primary key.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import { getTodayUsage, incrementUsage } from '../../server/storage/api-usage.js';

/**
 * `api_usage_daily.api_key_id` is a NOT NULL FK to `api_keys(id)`, so a usage
 * row needs a parent key. Insert a minimal one (the four NOT NULL columns) and
 * return its generated id.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<string>}
 */
async function seedApiKey(db) {
  const row = await db
    .insertInto('api_keys')
    .values({
      owner_email: 'owner@example.com',
      name: 'pg-test key',
      key_prefix: 'dk_test',
      key_hash: 'x'.repeat(64),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

pgDescribe('incrementUsage (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let apiKeyId;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    // CASCADE clears api_usage_daily children too, then reseed the parent key.
    await truncate(db, 'api_keys');
    apiKeyId = await seedApiKey(db);
  });

  it('inserts a fresh daily row on the first increment', async () => {
    const res = await incrementUsage(apiKeyId, { requests: 2, aiRequests: 1 });

    assert.equal(res.ok, true);
    assert.equal(res.requestCount, 2);
    assert.equal(res.aiRequestCount, 1);
    assert.equal(res.exportCount, 0);
  });

  it('accumulates via COALESCE(col, 0) + n on the conflict path', async () => {
    await incrementUsage(apiKeyId, { requests: 2, aiRequests: 1 });
    const res = await incrementUsage(apiKeyId, { requests: 3, exports: 1 });

    // Second call hits the (api_key_id, date) conflict and adds to the running
    // totals rather than replacing them.
    assert.equal(res.ok, true);
    assert.equal(res.requestCount, 5);
    assert.equal(res.aiRequestCount, 1);
    assert.equal(res.exportCount, 1);

    const today = await getTodayUsage(apiKeyId);
    assert.equal(today.requestCount, 5);
    assert.equal(today.aiRequestCount, 1);
    assert.equal(today.exportCount, 1);
  });

  it('keeps exactly one row per key per day across repeated increments', async () => {
    await incrementUsage(apiKeyId, { requests: 1 });
    await incrementUsage(apiKeyId, { requests: 1 });
    await incrementUsage(apiKeyId, { requests: 1 });

    const count = await db
      .selectFrom('api_usage_daily')
      .select(db.fn.countAll().as('n'))
      .where('api_key_id', '=', apiKeyId)
      .executeTakeFirst();
    assert.equal(Number(count.n), 1);
  });
});
