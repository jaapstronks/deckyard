/**
 * `acquireSlideLock` against real PostgreSQL.
 *
 * This is the #423 path — the atomic `INSERT ... ON CONFLICT DO UPDATE ...
 * WHERE` that replaced a check-then-delete-then-insert that raced two
 * concurrent acquires into a 500. It is the single strongest reason this suite
 * exists: PostgreSQL returns *no row* from the upsert when the `DO UPDATE`'s
 * WHERE is false, which is what `{ ok: false, reason: 'held' }` is built on.
 * The in-memory double has to emulate that silence by hand (tests/helpers/
 * fake-db.js); here the real database provides it, and the conflict target
 * `(presentation_id, slide_id)` — deliberately *without* organization_id
 * (migration 023) — is enforced by the constraint itself, not by a hand model.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, truncate } from './helpers/harness.js';
import {
  acquireSlideLock,
  getSlideLock,
} from '../../server/storage/slide-locks.js';

const CTX = { organizationId: 'org-pg-test' };
const PID = 'deck-1';
const SID = 'slide-1';
const ALICE = { email: 'alice@example.com', name: 'Alice' };
const BOB = { email: 'bob@example.com', name: 'Bob' };

describe('acquireSlideLock (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'slide_locks');
  });

  it('acquires a free slide and persists the holder', async () => {
    const res = await acquireSlideLock(PID, SID, ALICE, CTX);

    assert.equal(res.ok, true);
    assert.equal(res.lock.holderEmail, 'alice@example.com');
    assert.equal(res.lock.presentationId, PID);

    const stored = await getSlideLock(PID, SID, CTX);
    assert.equal(stored.holderEmail, 'alice@example.com');
  });

  it('lets the same holder re-acquire (refresh) without a second row', async () => {
    const first = await acquireSlideLock(PID, SID, ALICE, CTX);
    assert.equal(first.ok, true);

    const again = await acquireSlideLock(PID, SID, ALICE, CTX);
    assert.equal(again.ok, true);
    assert.equal(again.lock.holderEmail, 'alice@example.com');

    // The conflict target is (presentation_id, slide_id): a re-acquire is an
    // upsert, not an insert, so there is exactly one row.
    const count = await db
      .selectFrom('slide_locks')
      .select(db.fn.countAll().as('n'))
      .where('presentation_id', '=', PID)
      .where('slide_id', '=', SID)
      .executeTakeFirst();
    assert.equal(Number(count.n), 1);
  });

  it('reports { ok: false, reason: held } when a live lock is held by someone else', async () => {
    const alice = await acquireSlideLock(PID, SID, ALICE, CTX);
    assert.equal(alice.ok, true);

    // Bob hits the conflict; the DO UPDATE's WHERE is false (lock is live and
    // held by Alice), so PostgreSQL returns no row and the held branch runs.
    // This is the assertion the double can only imitate.
    const bob = await acquireSlideLock(PID, SID, BOB, CTX);
    assert.equal(bob.ok, false);
    assert.equal(bob.reason, 'held');
    assert.equal(bob.lock.holderEmail, 'alice@example.com');

    // Alice still holds it — Bob's failed acquire changed nothing.
    const stored = await getSlideLock(PID, SID, CTX);
    assert.equal(stored.holderEmail, 'alice@example.com');
  });

  it('lets another user take over an expired lock', async () => {
    // Seed a lock held by Alice that expired a minute ago. Inserting it
    // directly is the only way to control the clock the upsert reads.
    const past = new Date(Date.now() - 60_000).toISOString();
    await db
      .insertInto('slide_locks')
      .values({
        presentation_id: PID,
        slide_id: SID,
        organization_id: CTX.organizationId,
        holder_email: ALICE.email,
        holder_name: ALICE.name,
        acquired_at: past,
        refreshed_at: past,
        expires_at: past,
      })
      .execute();

    // Bob's acquire hits the conflict; the DO UPDATE's WHERE is true (expired),
    // so the upsert returns the updated row and Bob wins.
    const bob = await acquireSlideLock(PID, SID, BOB, CTX);
    assert.equal(bob.ok, true);
    assert.equal(bob.lock.holderEmail, 'bob@example.com');

    const stored = await getSlideLock(PID, SID, CTX);
    assert.equal(stored.holderEmail, 'bob@example.com');
  });
});
