/**
 * Lock holder identity on `users.id` (T10, PR F3).
 *
 * Migration 071 put a nullable `holder_user_id` beside `holder_email` on both
 * lock tables, and the storage layer stamps and matches on it through
 * `shared/identity-match.js` (id-primary, e-mail fallback). This file pins the
 * behaviour that motivates the whole change and can only be shown against a real
 * database — where the id column, the FK and the atomic slide-lock upsert are
 * enforced by PostgreSQL, not a hand double (tests/helpers/fake-db.js):
 *
 *   - **the stamp** — an acquire persists the holder's `users.id`, and the read
 *     surfaces it as `holderId`;
 *   - **rename-robustness** — a holder who changes their account e-mail keeps
 *     their own lock: they refresh it, release it and re-acquire it, and it never
 *     reads as "held by someone else" to them. This is the F3 improvement, and
 *     the one thing the old raw-e-mail compare could never give;
 *   - **the external path** — a holder with no `users` row (an external
 *     collaborator) stamps a NULL id and is still matched by e-mail, unchanged;
 *   - **transfer resolves the requester** — accepting a lock request stamps the
 *     new holder's id, resolved from the e-mail on the request row (the only
 *     write whose id is not the authed session's).
 *
 * Runs only against the throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import {
  acquireSlideLock,
  refreshSlideLock,
  releaseSlideLock,
  releaseAllUserSlideLocks,
  getSlideLock,
  getLockedByOthers,
} from '../../server/storage/slide-locks.js';
import {
  acquirePresentationLock,
  refreshPresentationLock,
  releasePresentationLock,
  createLockRequest,
  acceptLockRequest,
} from '../../server/storage/presentation-locks-db.js';

// A real uuid: organizations.id and users.organization_id are uuid columns,
// while slide_locks.organization_id is free text — one value keys all three.
const ORG = '99999999-9999-9999-9999-999999999999';
const CTX = { organizationId: ORG };
// presentation_locks.presentation_id is a uuid FK to presentations(id); a real
// row must exist. slide_locks.presentation_id is free text, so the same value
// serves both tables.
const PID = '33333333-3333-3333-3333-333333333333';
const SID = 'slide-1';

const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const ALICE_EMAIL = 'alice@example.com';
const ALICE_NEW_EMAIL = 'alice.renamed@example.com';
const BOB_ID = '22222222-2222-2222-2222-222222222222';
const BOB_EMAIL = 'bob@example.com';
const EXTERNAL_EMAIL = 'ext@example.com';

/** The acting-user shape the routes hand the storage layer. */
const alice = (email = ALICE_EMAIL) => ({ email, name: 'Alice', userId: ALICE_ID });
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
    await truncate(db, 'slide_locks', 'presentation_locks', 'lock_requests', 'presentations', 'users', 'organizations');
    await db.insertInto('organizations').values({ id: ORG, name: 'Default', slug: 'default' }).execute();
    await db
      .insertInto('users')
      .values([
        { id: ALICE_ID, organization_id: ORG, email: ALICE_EMAIL, name: 'Alice', role: 'user' },
        { id: BOB_ID, organization_id: ORG, email: BOB_EMAIL, name: 'Bob', role: 'user' },
      ])
      .execute();
    // The whole-deck lock's presentation_id is a real FK; slide locks reference
    // the same id as free text.
    await db.insertInto('presentations').values({ id: PID, title: 'Deck', organization_id: ORG }).execute();
  });

  /** Rename a `users` row the way an account e-mail change does. */
  async function renameUser(id, email) {
    await db.updateTable('users').set({ email }).where('id', '=', id).execute();
  }

  // ── Slide locks ────────────────────────────────────────────────

  it('stamps and surfaces the holder users.id on a slide lock', async () => {
    const res = await acquireSlideLock(PID, SID, alice(), CTX);
    assert.equal(res.ok, true);
    assert.equal(res.lock.holderId, ALICE_ID);
    assert.equal(res.lock.holderEmail, ALICE_EMAIL);

    const stored = await getSlideLock(PID, SID, CTX);
    assert.equal(stored.holderId, ALICE_ID);
  });

  it('a renamed holder refreshes, releases and re-acquires their own slide lock', async () => {
    await acquireSlideLock(PID, SID, alice(), CTX);
    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);

    // The stored row still says alice@example.com; Alice now presents her new
    // address plus her unchanged id. The e-mail no longer matches, the id does.
    const refreshed = await refreshSlideLock(PID, SID, alice(ALICE_NEW_EMAIL), CTX);
    assert.equal(refreshed.ok, true, 'refresh recognizes the holder by id after a rename');

    const released = await releaseSlideLock(PID, SID, alice(ALICE_NEW_EMAIL), CTX);
    assert.equal(released.ok, true);
    assert.equal(released.released, true, 'release recognizes the holder by id after a rename');

    const reacquired = await acquireSlideLock(PID, SID, alice(ALICE_NEW_EMAIL), CTX);
    assert.equal(reacquired.ok, true);
    assert.equal(reacquired.lock.holderId, ALICE_ID);
  });

  it("a renamed holder's own live lock is never 'locked by others' to them", async () => {
    await acquireSlideLock(PID, SID, alice(), CTX);
    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);

    // Alice's own live lock: the raw-e-mail filter this replaced would have
    // listed it (stored old address ≠ her new one); the id match excludes it.
    const others = await getLockedByOthers(PID, alice(ALICE_NEW_EMAIL), CTX);
    assert.deepEqual(others, []);

    // Bob, meanwhile, sees it as held.
    const bobSees = await getLockedByOthers(PID, bob(), CTX);
    assert.equal(bobSees.length, 1);
    assert.equal(bobSees[0].slideId, SID);
  });

  it("another user cannot take, refresh or release a live lock held by id", async () => {
    await acquireSlideLock(PID, SID, alice(), CTX);

    const grab = await acquireSlideLock(PID, SID, bob(), CTX);
    assert.equal(grab.ok, false);
    assert.equal(grab.reason, 'held');
    assert.equal(grab.lock.holderId, ALICE_ID);

    const steal = await releaseSlideLock(PID, SID, bob(), CTX);
    assert.equal(steal.ok, false);
    assert.equal(steal.reason, 'held');

    // Alice still holds it — nobody else's attempt changed anything.
    assert.equal((await getSlideLock(PID, SID, CTX)).holderId, ALICE_ID);
  });

  it('an external holder (no users row) stamps NULL and is matched by e-mail', async () => {
    const res = await acquireSlideLock(PID, SID, external, CTX);
    assert.equal(res.ok, true);
    assert.equal(res.lock.holderId, null);

    // The external holder still refreshes their own lock via the e-mail fallback.
    const refreshed = await refreshSlideLock(PID, SID, external, CTX);
    assert.equal(refreshed.ok, true);

    // And Alice sees it as held by someone else.
    const others = await getLockedByOthers(PID, alice(), CTX);
    assert.equal(others.length, 1);
    assert.equal(others[0].holderEmail, EXTERNAL_EMAIL);
  });

  it('release-all tears down a renamed holder\'s locks by id', async () => {
    await acquireSlideLock(PID, 'slide-a', alice(), CTX);
    await acquireSlideLock(PID, 'slide-b', alice(), CTX);
    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);

    const res = await releaseAllUserSlideLocks(PID, alice(ALICE_NEW_EMAIL), CTX);
    assert.equal(res.ok, true);
    assert.equal(res.releasedCount, 2, 'both locks removed despite the stored old address');
  });

  // ── Presentation locks ─────────────────────────────────────────

  it('a renamed holder keeps their whole-deck lock', async () => {
    const acq = await acquirePresentationLock(PID, alice(), CTX);
    assert.equal(acq.ok, true);
    assert.equal(acq.lock.holderId, ALICE_ID);

    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);

    const refreshed = await refreshPresentationLock(PID, alice(ALICE_NEW_EMAIL), CTX);
    assert.equal(refreshed.ok, true, 'the holder is recognized by id after a rename');
    assert.equal(refreshed.lock.holderId, ALICE_ID);

    // The acquire path re-stamps both halves, bringing the stored e-mail back in
    // step with the id (the minimal refresh above only extends the TTL).
    const reacquired = await acquirePresentationLock(PID, alice(ALICE_NEW_EMAIL), CTX);
    assert.equal(reacquired.ok, true);
    assert.equal(reacquired.lock.holderEmail, ALICE_NEW_EMAIL);

    const released = await releasePresentationLock(PID, alice(ALICE_NEW_EMAIL), CTX);
    assert.equal(released.ok, true);
    assert.equal(released.released, true);
  });

  it('accepting a lock request stamps the requester\'s resolved id', async () => {
    // Alice holds the deck; Bob requests it; Alice accepts. The transfer must
    // stamp Bob's id — resolved from the e-mail on his request row, the one
    // write whose holder id is not the authed session's.
    await acquirePresentationLock(PID, alice(), CTX);
    const req = await createLockRequest(PID, { email: BOB_EMAIL, name: 'Bob' }, CTX);
    assert.equal(req.ok, true);

    const accepted = await acceptLockRequest(req.request.id, {}, CTX);
    assert.equal(accepted.ok, true);

    const row = await db
      .selectFrom('presentation_locks')
      .select(['holder_user_id', 'holder_email'])
      .where('presentation_id', '=', PID)
      .where('organization_id', '=', ORG)
      .executeTakeFirst();
    assert.equal(row.holder_user_id, BOB_ID, 'the transferred lock carries the requester id');
    assert.equal(row.holder_email, BOB_EMAIL);
  });

  it('a transfer to an external requester (no users row) stamps NULL', async () => {
    await acquirePresentationLock(PID, alice(), CTX);
    const req = await createLockRequest(PID, { email: EXTERNAL_EMAIL, name: 'Ext' }, CTX);
    const accepted = await acceptLockRequest(req.request.id, {}, CTX);
    assert.equal(accepted.ok, true);

    const row = await db
      .selectFrom('presentation_locks')
      .select(['holder_user_id', 'holder_email'])
      .where('presentation_id', '=', PID)
      .where('organization_id', '=', ORG)
      .executeTakeFirst();
    assert.equal(row.holder_user_id, null);
    assert.equal(row.holder_email, EXTERNAL_EMAIL);
  });

  it('deleting the holder user keeps the lock row, id dropped (ON DELETE SET NULL)', async () => {
    await acquireSlideLock(PID, SID, bob(), CTX);
    await db.deleteFrom('users').where('id', '=', BOB_ID).execute();

    const stored = await getSlideLock(PID, SID, CTX);
    assert.equal(stored.holderId, null, 'the FK dropped the id but not the lock');
    assert.equal(stored.holderEmail, BOB_EMAIL);
  });
});
