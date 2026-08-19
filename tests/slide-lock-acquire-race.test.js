/**
 * `acquireSlideLock` handles a conflicting acquire instead of throwing a 500.
 *
 * The old implementation did check-then-delete-then-insert: two acquires both
 * passed the "no existing lock" SELECT, both deleted nothing, and the second
 * INSERT violated the (presentation_id, slide_id) unique constraint — a 500 that
 * quietly filled the server log. The fix is a single INSERT ... ON CONFLICT DO
 * UPDATE whose WHERE only lets an expired or same-holder acquire through.
 *
 * SCOPE OF THIS TEST — read before trusting it. It runs against the in-memory
 * db double (tests/helpers/fake-db.js), which now enforces the real slide_locks
 * unique constraint and models ON CONFLICT. It therefore proves that the code
 * takes the upsert path and that a second acquire on a live lock resolves to
 * { ok: false, reason: 'held' } WITHOUT raising the unique violation the double
 * would otherwise throw. It does NOT prove that PostgreSQL performs this upsert
 * atomically under genuinely concurrent transactions — the double is
 * single-threaded and cannot interleave two acquires. Real atomicity can only
 * be verified against a live PostgreSQL, and there is no PostgreSQL in CI (see
 * the note at the bottom of the PR). A test that claimed to cover the race would
 * be worse than this one.
 *
 * Run with: node --test tests/slide-lock-acquire-race.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb, UniqueViolationError } =
  await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { acquireSlideLock } = await import('../server/storage/slide-locks.js');

const ORG = '00000000-0000-0000-0000-0000000000aa';
const PID = 'deck-1';
const SID = 'slide-1';
// A lock is held by a `users.id`; the address and name ride along for display
// (shared/identity-match.js).
const ALICE = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'alice@example.com',
  name: 'Alice',
};
const BOB = {
  userId: '22222222-2222-4222-8222-222222222222',
  email: 'bob@example.com',
  name: 'Bob',
};
const ctx = { organizationId: ORG };

/** Rows currently in the slide_locks table of the installed double. */
let db;

const lockRow = (overrides = {}) => ({
  presentation_id: PID,
  slide_id: SID,
  organization_id: ORG,
  holder_user_id: ALICE.userId,
  holder_email: ALICE.email,
  holder_name: ALICE.name,
  acquired_at: '2020-01-01T00:00:00.000Z',
  refreshed_at: '2020-01-01T00:00:00.000Z',
  expires_at: '2999-01-01T00:00:00.000Z', // far future = live
  ...overrides,
});

const rows = () => db.__tables.slide_locks || [];

beforeEach(() => {
  db = createFakeDb();
  __setTestDb(db);
});

afterEach(() => {
  __setTestDb(null);
});

describe('acquireSlideLock — conflicting acquire', () => {
  it('grants the lock when the slide is free', async () => {
    const res = await acquireSlideLock(ctx, PID, SID, ALICE);
    assert.equal(res.ok, true);
    assert.equal(res.lock.holderEmail, ALICE.email);
    assert.equal(rows().length, 1);
  });

  it('reports { held } for a second holder instead of throwing a 500', async () => {
    await acquireSlideLock(ctx, PID, SID, ALICE);

    // The double enforces the unique constraint, so the old delete-then-insert
    // would have thrown here. The upsert must resolve cleanly to `held`.
    const res = await acquireSlideLock(ctx, PID, SID, BOB);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'held');
    assert.equal(
      res.lock.holderEmail,
      ALICE.email,
      'the original holder keeps the lock',
    );
    assert.equal(rows().length, 1, 'no duplicate row was inserted');
  });

  it('refreshes in place when the same holder re-acquires a live lock', async () => {
    const first = await acquireSlideLock(ctx, PID, SID, ALICE);
    const again = await acquireSlideLock(ctx, PID, SID, ALICE);
    assert.equal(again.ok, true);
    assert.equal(again.lock.holderEmail, ALICE.email);
    // Extended, not duplicated.
    assert.equal(rows().length, 1);
    assert.ok(again.lock.expiresAt >= first.lock.expiresAt);
  });

  it('takes over an expired lock held by someone else', async () => {
    db = createFakeDb({
      slide_locks: [lockRow({ expires_at: '2000-01-01T00:00:00.000Z' })], // held by Alice, expired
    });
    __setTestDb(db);

    const res = await acquireSlideLock(ctx, PID, SID, BOB);
    assert.equal(res.ok, true);
    assert.equal(
      res.lock.holderEmail,
      BOB.email,
      'the expired lock is taken over',
    );
    assert.equal(rows().length, 1);
  });
});

describe('acquireSlideLock — substrate sanity', () => {
  it('the double enforces the (presentation_id, slide_id) unique constraint', async () => {
    // Pins that the "no throw" above is meaningful: a raw duplicate insert — the
    // shape the old code produced when it raced — really does raise the pg-style
    // violation, so the upsert path taking `held` instead is a real difference.
    db = createFakeDb({ slide_locks: [lockRow()] });
    __setTestDb(db);
    await assert.rejects(
      db.insertInto('slide_locks').values(lockRow()).execute(),
      (err) => err instanceof UniqueViolationError && err.code === '23505',
    );
  });
});
