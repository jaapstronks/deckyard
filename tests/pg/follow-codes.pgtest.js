/**
 * Follow-code storage against real PostgreSQL.
 *
 * Codes moved off `follow-codes.json` into the `follow_codes` table, which
 * migration 060 first had to widen: the 001 schema declared `code` as
 * `char(4)` while the generator has produced five characters since the M3
 * keyspace fix. That mismatch is invisible to the in-memory double — it stores
 * whatever string it is handed — and would have made every single insert fail
 * in production. Hence the first test: mint a code and read it back *through
 * the column*.
 *
 * The table is instance-global (migration 060 dropped the unused
 * organization_id), so no parent rows need seeding.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from '../helpers/storage-scope.js';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import {
  createFollowCode,
  resolveFollowCode,
  cleanupExpiredCodes,
  FOLLOW_CODE_TTL_MS,
} from '../../server/storage/follow-codes.js';

pgDescribe('follow-code storage (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'follow_codes');
  });

  it('mints a five-character code and resolves it back to its follow URL', async () => {
    const followUrl = '/follow/deck-42?lang=nl';
    const code = await createFollowCode(testScope(), followUrl);

    assert.equal(typeof code, 'string');
    assert.equal(code.length, 5, 'the widened column holds the full code');
    assert.match(code, /^[A-HJ-NPRT-Y]{5}$/, 'only unambiguous letters');

    // Straight from the column: char(4) would have rejected the insert, and a
    // char(n) of any width would blank-pad what comes back.
    const row = await db
      .selectFrom('follow_codes')
      .select(['code', 'follow_url'])
      .executeTakeFirstOrThrow();
    assert.equal(row.code, code, 'stored unpadded and untruncated');
    assert.equal(row.follow_url, followUrl);

    assert.equal(await resolveFollowCode(testScope(), code), followUrl);
  });

  it('resolves case-insensitively and misses on an unknown code', async () => {
    const code = await createFollowCode(
      testScope(),
      '/follow/deck-42?lang=en-GB',
    );
    assert.equal(
      await resolveFollowCode(testScope(), code.toLowerCase()),
      '/follow/deck-42?lang=en-GB',
    );
    assert.equal(await resolveFollowCode(testScope(), 'ZZZZZ'), null);
  });

  it('mints distinct codes for the two languages of one deck', async () => {
    const nl = await createFollowCode(testScope(), '/follow/deck-42?lang=nl');
    const en = await createFollowCode(
      testScope(),
      '/follow/deck-42?lang=en-GB',
    );
    assert.notEqual(nl, en);
    assert.equal(
      await resolveFollowCode(testScope(), nl),
      '/follow/deck-42?lang=nl',
    );
    assert.equal(
      await resolveFollowCode(testScope(), en),
      '/follow/deck-42?lang=en-GB',
    );
  });

  it('refuses to resolve an expired code and deletes it on the way out', async () => {
    const code = await createFollowCode(testScope(), '/follow/deck-42?lang=nl');
    await db
      .updateTable('follow_codes')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('code', '=', code)
      .execute();

    assert.equal(await resolveFollowCode(testScope(), code), null);

    const rows = await db.selectFrom('follow_codes').selectAll().execute();
    assert.equal(
      rows.length,
      0,
      'an expired hit is cleaned up, not left to rot',
    );
  });

  it('sweeps expired codes and leaves live ones alone', async () => {
    const live = await createFollowCode(testScope(), '/follow/live?lang=nl');
    const stale = await createFollowCode(testScope(), '/follow/stale?lang=nl');
    await db
      .updateTable('follow_codes')
      .set({ expires_at: new Date(Date.now() - FOLLOW_CODE_TTL_MS) })
      .where('code', '=', stale)
      .execute();

    assert.equal(await cleanupExpiredCodes(testScope()), 1);

    const rows = await db.selectFrom('follow_codes').select('code').execute();
    assert.deepEqual(
      rows.map((r) => r.code),
      [live],
    );
    // Idempotent: nothing left to collect on a second pass.
    assert.equal(await cleanupExpiredCodes(testScope()), 0);
  });
});
