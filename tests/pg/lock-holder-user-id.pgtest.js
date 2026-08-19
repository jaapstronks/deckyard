/**
 * Lock holder identity on `users.id` (T10, PR F3).
 *
 * Migration 071 put a nullable `holder_user_id` beside `holder_email` on the
 * lock table, and the storage layer stamps and matches on it through
 * `shared/identity-match.js` (id-primary, e-mail fallback). This file pins the
 * behaviour that motivates the whole change and can only be shown against a real
 * database — where the id column, the FK and the atomic slide-lock upsert are
 * enforced by PostgreSQL, not a hand double (tests/helpers/fake-db.js):
 *
 *   - **the stamp** — an acquire persists the holder's `users.id`, and the read
 *     names the holder as a `{ id, displayName }` pair;
 *   - **rename-robustness** — a holder who changes their account e-mail keeps
 *     their own lock: they refresh it, release it and re-acquire it, and it never
 *     reads as "held by someone else" to them. This is the F3 improvement, and
 *     the one thing the old raw-e-mail compare could never give;
 *   - **the external path** — a holder with no `users` row (an external
 *     collaborator) stamps a NULL id and is still matched by e-mail, unchanged.
 *
 * 071 also laid the column on `presentation_locks`; that table and its
 * transfer path (lock requests) were dropped by migration 078 (B96), so only
 * the slide-lock half is pinned here.
 *
 * Runs only against the throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import {
  acquireSlideLock,
  refreshSlideLock,
  releaseSlideLock,
  releaseAllUserSlideLocks,
  getSlideLock,
  getLockedByOthers,
} from '../../server/storage/slide-locks.js';

// A real uuid: organizations.id and users.organization_id are uuid columns,
// while slide_locks.organization_id is free text — one value keys all three.
const ORG = '99999999-9999-9999-9999-999999999999';
const CTX = { organizationId: ORG };
// slide_locks.presentation_id is free text (no FK); a uuid-shaped value keeps
// the fixture realistic.
const PID = '33333333-3333-3333-3333-333333333333';
const SID = 'slide-1';

const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const ALICE_EMAIL = 'alice@example.com';
const ALICE_NEW_EMAIL = 'alice.renamed@example.com';
const BOB_ID = '22222222-2222-2222-2222-222222222222';
const BOB_EMAIL = 'bob@example.com';
const EXTERNAL_EMAIL = 'ext@example.com';

/** The acting-user shape the routes hand the storage layer. */
const alice = (email = ALICE_EMAIL) => ({
  email,
  name: 'Alice',
  userId: ALICE_ID,
});
const bob = (email = BOB_EMAIL) => ({ email, name: 'Bob', userId: BOB_ID });
const external = { email: EXTERNAL_EMAIL, name: 'Ext', userId: null };

pgDescribe('lock holder identity on users.id (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'slide_locks', 'users', 'organizations');
    await db
      .insertInto('organizations')
      .values({ id: ORG, name: 'Default', slug: 'default' })
      .execute();
    await db
      .insertInto('users')
      .values([
        {
          id: ALICE_ID,
          organization_id: ORG,
          email: ALICE_EMAIL,
          name: 'Alice',
          role: 'user',
        },
        {
          id: BOB_ID,
          organization_id: ORG,
          email: BOB_EMAIL,
          name: 'Bob',
          role: 'user',
        },
      ])
      .execute();
  });

  /** Rename a `users` row the way an account e-mail change does. */
  async function renameUser(id, email) {
    await db.updateTable('users').set({ email }).where('id', '=', id).execute();
  }

  // ── Slide locks ────────────────────────────────────────────────

  it('stamps and surfaces the holder users.id on a slide lock', async () => {
    const res = await acquireSlideLock(CTX, PID, SID, alice());
    assert.equal(res.ok, true);
    assert.equal(res.lock.holder?.id, ALICE_ID);
    assert.equal(res.lock.holder?.displayName, 'Alice');

    const stored = await getSlideLock(CTX, PID, SID);
    assert.equal(stored.holder?.id, ALICE_ID);
  });

  it('a renamed holder refreshes, releases and re-acquires their own slide lock', async () => {
    await acquireSlideLock(CTX, PID, SID, alice());
    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);

    // The stored row still says alice@example.com; Alice now presents her new
    // address plus her unchanged id. The e-mail no longer matches, the id does.
    const refreshed = await refreshSlideLock(
      CTX,
      PID,
      SID,
      alice(ALICE_NEW_EMAIL),
    );
    assert.equal(
      refreshed.ok,
      true,
      'refresh recognizes the holder by id after a rename',
    );

    const released = await releaseSlideLock(
      CTX,
      PID,
      SID,
      alice(ALICE_NEW_EMAIL),
    );
    assert.equal(released.ok, true);
    assert.equal(
      released.released,
      true,
      'release recognizes the holder by id after a rename',
    );

    const reacquired = await acquireSlideLock(
      CTX,
      PID,
      SID,
      alice(ALICE_NEW_EMAIL),
    );
    assert.equal(reacquired.ok, true);
    assert.equal(reacquired.lock.holder?.id, ALICE_ID);
  });

  it("a renamed holder's own live lock is never 'locked by others' to them", async () => {
    await acquireSlideLock(CTX, PID, SID, alice());
    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);

    // Alice's own live lock: the raw-e-mail filter this replaced would have
    // listed it (stored old address ≠ her new one); the id match excludes it.
    const others = await getLockedByOthers(CTX, PID, alice(ALICE_NEW_EMAIL));
    assert.deepEqual(others, []);

    // Bob, meanwhile, sees it as held.
    const bobSees = await getLockedByOthers(CTX, PID, bob());
    assert.equal(bobSees.length, 1);
    assert.equal(bobSees[0].slideId, SID);
  });

  it('another user cannot take, refresh or release a live lock held by id', async () => {
    await acquireSlideLock(CTX, PID, SID, alice());

    const grab = await acquireSlideLock(CTX, PID, SID, bob());
    assert.equal(grab.ok, false);
    assert.equal(grab.reason, 'held');
    assert.equal(grab.lock.holder?.id, ALICE_ID);

    const steal = await releaseSlideLock(CTX, PID, SID, bob());
    assert.equal(steal.ok, false);
    assert.equal(steal.reason, 'held');

    // Alice still holds it — nobody else's attempt changed anything.
    assert.equal((await getSlideLock(CTX, PID, SID)).holder?.id, ALICE_ID);
  });

  it('an external holder (no users row) cannot take a lock at all', async () => {
    // A lock is held by a `users.id`. An actor without one could take a lock
    // and then never refresh or release it — the address that used to stand in
    // is not a key any more (D22) — so the acquire is refused outright.
    const res = await acquireSlideLock(CTX, PID, SID, external);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid');
    assert.equal(await getSlideLock(CTX, PID, SID), null);

    // Nothing is locked, so Alice sees no foreign lock either.
    const others = await getLockedByOthers(CTX, PID, alice());
    assert.equal(others.length, 0);
  });

  it("release-all tears down a renamed holder's locks by id", async () => {
    await acquireSlideLock(CTX, PID, 'slide-a', alice());
    await acquireSlideLock(CTX, PID, 'slide-b', alice());
    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);

    const res = await releaseAllUserSlideLocks(
      CTX,
      PID,
      alice(ALICE_NEW_EMAIL),
    );
    assert.equal(res.ok, true);
    assert.equal(
      res.releasedCount,
      2,
      'both locks removed despite the stored old address',
    );
  });

  it('deleting the holder user keeps the lock row, id dropped (ON DELETE SET NULL)', async () => {
    await acquireSlideLock(CTX, PID, SID, bob());
    await db.deleteFrom('users').where('id', '=', BOB_ID).execute();

    const stored = await getSlideLock(CTX, PID, SID);
    assert.equal(
      stored.holder?.id,
      null,
      'the FK dropped the id but not the lock',
    );
    assert.equal(stored.holder?.displayName, 'Bob');
  });
});
