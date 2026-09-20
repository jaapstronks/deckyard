/**
 * B373 — two writers creating the same tag name at the same time, against real
 * PostgreSQL.
 *
 * Resolving a tag name used to be a look followed by an insert. Two requests in
 * one organization writing the same not-yet-existing name both missed the look,
 * both inserted, and the second collided with `idx_tags_org_name` — a `23505`
 * that left the request as a 500. Within one request it could not happen (a
 * transaction sees its own insert), so nothing that drives the facade from a
 * single connection can reproduce it, and the fake database cannot either: the
 * double has no concurrency at all. It needs two connections that overlap.
 *
 * **How the collision is forced.** A second connection opens a transaction,
 * inserts the tag, and *stays open*. The facade call then runs on the pool: its
 * insert reaches the unique index, finds the other transaction's uncommitted
 * row, and blocks — PostgreSQL makes the second writer wait rather than guess.
 * The test waits until it can see that block in `pg_stat_activity`, so the
 * interleaving is real and not a hopeful `await`; only then does it commit the
 * other transaction, which releases the facade into exactly the losing half of
 * the race. This is the same tactic as the temporary CHECK constraint in
 * tests/pg/collection-membership-atomicity.pgtest.js: force the condition at
 * the database, where the defect is, instead of through application input.
 *
 * On `main` the released insert answers `23505` and the facade call rejects.
 * The property pinned here is that it resolves instead, to **the tag the other
 * writer committed** — one tag row, two happy writers.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import pg from 'pg';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createTag,
  getTagsForPresentation,
  listTags,
  setTagsForPresentation,
} from '../../server/storage/tags.js';

const { Pool } = pg;

const storageScope = testScope();

/** The name both writers reach for. It exists in neither run beforehand. */
const CONTESTED = 'Kwartaalcijfers';

/**
 * Wait until some backend on this database is blocked on a lock — the facade's
 * insert queueing behind the open transaction's row. Polling `pg_stat_activity`
 * is what makes the interleaving a fact instead of a hope: without it the test
 * would sometimes commit before the insert ever reached the index, and then it
 * passes on `main` too, which is the difference between a test that pins the
 * disagreement and one that describes the behaviour.
 *
 * @param {import('pg').PoolClient} client - A connection *not* part of the race
 * @returns {Promise<void>}
 */
async function waitUntilBlocked(client) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND state = 'active'`,
    );
    if (rows[0].waiting > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        'the tag insert never blocked on the open transaction — the two ' +
          'writers did not overlap, so this run proves nothing',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

pgDescribe('two writers create the same tag at once (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** A pool of its own: the facade's writer must not share this connection. */
  /** @type {import('pg').Pool} */
  let rival;
  let orgId;
  let presentationId;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    rival = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  });

  after(async () => {
    uninstallFacadeStorage();
    await rival.end();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'presentations', 'tags', 'users', 'organizations');
    orgId = await seedDefaultOrganization(db);
    presentationId = await seedPresentation(db);
  });

  /**
   * Hand a connection back to the pool with no transaction left open. A test
   * that failed mid-race would otherwise return it still in one, and the next
   * test's TRUNCATE would wait on it until the suite times out.
   *
   * @param {import('pg').PoolClient} client
   * @returns {Promise<void>}
   */
  async function releaseIdle(client) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }

  /**
   * Run `write` while another connection holds an uncommitted `tags` row for
   * {@link CONTESTED}, releasing that row only once `write` is demonstrably
   * blocked on it. Resolves to what `write` answered, and to the id the rival
   * committed.
   *
   * @param {() => Promise<any>} write
   * @returns {Promise<{answer: any, rivalTagId: string}>}
   */
  async function raceAgainstRival(write) {
    const held = await rival.connect();
    let rivalTagId;
    let answer;
    try {
      await held.query('BEGIN');
      const { rows } = await held.query(
        'INSERT INTO tags (organization_id, name, created_at) ' +
          'VALUES ($1, $2, now()) RETURNING id',
        [orgId, CONTESTED],
      );
      rivalTagId = rows[0].id;

      // Deliberately not awaited: it is meant to block.
      const writing = write();

      const watcher = await rival.connect();
      try {
        await waitUntilBlocked(watcher);
      } finally {
        watcher.release();
      }

      await held.query('COMMIT');
      answer = await writing;
    } finally {
      await releaseIdle(held);
    }
    return { answer, rivalTagId };
  }

  it('lets the losing tag write land on the winner’s tag', async () => {
    const { answer, rivalTagId } = await raceAgainstRival(() =>
      setTagsForPresentation(storageScope, presentationId, [CONTESTED]),
    );

    assert.equal(
      answer.ok,
      true,
      'the write stands instead of crashing on 23505',
    );
    assert.equal(answer.tags.length, 1);
    assert.equal(
      answer.tags[0].id,
      rivalTagId,
      'and it is the tag the other writer committed, not a second one',
    );
    assert.deepEqual(
      (await getTagsForPresentation(storageScope, presentationId)).map(
        (t) => t.name,
      ),
      [CONTESTED],
      'the link points at that tag',
    );
    assert.equal(
      (await listTags(storageScope)).length,
      1,
      'one tag row exists for the contested name',
    );
  });

  it('answers createTag with the winner’s tag rather than a 23505', async () => {
    const { answer, rivalTagId } = await raceAgainstRival(() =>
      createTag(storageScope, CONTESTED),
    );

    assert.equal(answer.ok, true);
    assert.equal(answer.tag.id, rivalTagId);
    assert.equal((await listTags(storageScope)).length, 1);
  });

  it('resolves a differently cased spelling to the same row', async () => {
    // The rival commits `Kwartaalcijfers`; the facade asks for
    // `KWARTAALCIJFERS`. The index folds them together, so the loser must land
    // on the winner's row here too — the fold that decides it is PostgreSQL's,
    // not one this test performs.
    const { answer, rivalTagId } = await raceAgainstRival(() =>
      setTagsForPresentation(storageScope, presentationId, [
        CONTESTED.toUpperCase(),
      ]),
    );

    assert.equal(answer.ok, true);
    assert.equal(answer.tags[0].id, rivalTagId);
    assert.equal(
      answer.tags[0].name,
      CONTESTED,
      'under the spelling that got there first',
    );
    assert.equal((await listTags(storageScope)).length, 1);
  });

  it('still creates the tag when the other writer rolls back', async () => {
    // The mirror of the race: the insert blocks, the rival aborts, and
    // PostgreSQL lets the waiting insert through. Nothing may be swallowed —
    // the tag has to exist afterwards, created by the writer that waited.
    const held = await rival.connect();
    let answer;
    try {
      await held.query('BEGIN');
      await held.query(
        'INSERT INTO tags (organization_id, name, created_at) ' +
          'VALUES ($1, $2, now())',
        [orgId, CONTESTED],
      );
      const writing = setTagsForPresentation(storageScope, presentationId, [
        CONTESTED,
      ]);
      const watcher = await rival.connect();
      try {
        await waitUntilBlocked(watcher);
      } finally {
        watcher.release();
      }
      await held.query('ROLLBACK');
      answer = await writing;
    } finally {
      await releaseIdle(held);
    }

    assert.equal(answer.ok, true);
    assert.equal(answer.tags.length, 1);
    assert.equal(answer.tags[0].name, CONTESTED);
    assert.equal((await listTags(storageScope)).length, 1);
  });
});
