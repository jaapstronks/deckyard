/**
 * `markThreadsRead` against real PostgreSQL.
 *
 * Marking comment threads read (server/storage/presentations/comments.js) batch-
 * upserts `comment_thread_reads` with ON CONFLICT (user_email, comment_id) DO
 * UPDATE SET last_read_at. This is the heaviest foreign-key chain of the
 * upsert sites: a read row points at a `presentation_comments(id)` (FK, ON
 * DELETE CASCADE), which points at a `presentations(id)`, which points at an
 * `organizations(id)` — so the fixture builds org → deck → comment before the
 * marker can exist. Only a real database enforces that chain and the composite
 * primary key the conflict target names (migration 042); the double models
 * neither, and would silently accept a marker on a comment that never existed.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createComment,
  markThreadsRead,
} from '../../server/storage/presentations/comments.js';

const ALICE = 'alice@example.com';
const ctx = testScope(null, { actorEmail: ALICE });

pgDescribe('markThreadsRead (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let pid;

  /** Create a top-level comment on the seeded deck and return its id. */
  const seedComment = async (body = 'A note') => {
    const res = await createComment(ctx, pid, { email: 'author@example.com', body });
    assert.equal(res.ok, true);
    return res.comment.id;
  };

  const readRowsFor = (commentId) =>
    db
      .selectFrom('comment_thread_reads')
      .select(['user_email', 'last_read_at'])
      .where('comment_id', '=', commentId)
      .execute();

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

  it('inserts a read marker for each valid top-level comment', async () => {
    const c1 = await seedComment('one');
    const c2 = await seedComment('two');

    const res = await markThreadsRead(ctx, pid, [c1, c2]);
    assert.equal(res.ok, true);
    assert.equal(res.marked, 2);

    assert.equal((await readRowsFor(c1)).length, 1);
    assert.equal((await readRowsFor(c2)).length, 1);
  });

  it('updates last_read_at in place on the (user_email, comment_id) conflict', async () => {
    const c1 = await seedComment();

    await markThreadsRead(ctx, pid, [c1]);
    const [first] = await readRowsFor(c1);

    // Force a distinct wall-clock second write. nowIso() has second-or-finer
    // resolution; back-date the first row so the update is observably newer.
    await db
      .updateTable('comment_thread_reads')
      .set({ last_read_at: '2000-01-01T00:00:00.000Z' })
      .where('comment_id', '=', c1)
      .where('user_email', '=', ALICE)
      .execute();

    const res = await markThreadsRead(ctx, pid, [c1]);
    assert.equal(res.marked, 1);

    const rows = await readRowsFor(c1);
    assert.equal(rows.length, 1, 'exactly one marker per (user, comment)');
    assert.notEqual(
      new Date(rows[0].last_read_at).toISOString(),
      '2000-01-01T00:00:00.000Z',
      'the conflict path bumped last_read_at'
    );
    assert.ok(first, 'the first mark did create a row');
  });

  it('ignores unknown ids and reply ids, marking only real top-level comments', async () => {
    const top = await seedComment('top');
    const reply = (
      await createComment(ctx, pid, { email: ALICE, body: 'reply', parentId: top })
    ).comment.id;
    const bogus = '00000000-0000-0000-0000-000000000000';

    const res = await markThreadsRead(ctx, pid, [top, reply, bogus]);
    assert.equal(res.ok, true);
    assert.equal(res.marked, 1, 'only the top-level comment counts');

    assert.equal((await readRowsFor(top)).length, 1);
    assert.equal((await readRowsFor(reply)).length, 0, 'replies get no marker');
    assert.equal((await readRowsFor(bogus)).length, 0);
  });

  it('cascades the marker away when its comment is deleted (FK CASCADE)', async () => {
    const c1 = await seedComment();
    await markThreadsRead(ctx, pid, [c1]);
    assert.equal((await readRowsFor(c1)).length, 1);

    await db.deleteFrom('presentation_comments').where('id', '=', c1).execute();
    assert.equal((await readRowsFor(c1)).length, 0, 'the read marker is cascaded out');
  });
});
