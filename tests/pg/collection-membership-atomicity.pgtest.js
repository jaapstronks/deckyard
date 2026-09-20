/**
 * Replacing a collection's membership is all-or-nothing (B371), against real
 * PostgreSQL.
 *
 * `replaceMembership` (server/storage/collections.js) — the one path behind
 * creating a collection with slides and updating its contents — used to be a
 * loose statement sequence: delete every `slide_collection_items` row, then
 * insert the new ones. The delete landed on its own. Anything that failed after
 * it (a connection that dropped, a constraint, an FK race with a slide deleted
 * between the filter and the insert) left the collection **empty** — the old
 * members gone, their order gone, the new ones never written, and no error path
 * that put them back.
 *
 * The property pinned here is that a failure after the delete rolls the whole
 * replacement back: the call rejects and the previous membership is still
 * there, **in its previous order**. Order is half the value of a collection, so
 * it is asserted as a sequence, not a set.
 *
 * **How the failure is forced.** The test adds a CHECK constraint to
 * `slide_collection_items` that refuses one specific slide-library id, then
 * asks for a replacement that includes that slide. The failure therefore lands
 * on the membership insert — exactly the statement whose loose form caused the
 * data loss — and it is forced at the database, not through application input,
 * so it survives any later change to how membership is validated (the
 * `filterExistingSlideIds` guard would drop a bogus id long before it reached
 * the insert). Without the transaction both failure cases below leave the
 * collection empty.
 *
 * **The metadata half (B372).** The same forced failure pins that an update
 * which renames *and* replaces applies neither when the replacement fails. The
 * metadata write cannot join `replaceMembership`'s transaction, so it runs
 * after it; before B372 it ran before, and a rolled back replacement left the
 * rename and a fresh `updated_at` standing behind the error.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import {
  seedDefaultOrganization,
  seedSlideLibraryItem,
} from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPersonalCollection,
  getPersonalCollection,
  updatePersonalCollection,
} from '../../server/storage/collections.js';

const storageScope = testScope();
const OWNER = 'owner@example.com';

pgDescribe('collection membership is replaced atomically (PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let sA;
  let sB;
  let sC;
  /** The slide whose membership row the database will refuse. */
  let poison;
  let collectionId;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'slide_collections', 'slide_library', 'organizations');
    await seedDefaultOrganization(db);

    sA = await seedSlideLibraryItem(db, { name: 'A' });
    sB = await seedSlideLibraryItem(db, { name: 'B' });
    sC = await seedSlideLibraryItem(db, { name: 'C' });
    poison = await seedSlideLibraryItem(db, { name: 'Poison' });

    const created = await createPersonalCollection(
      storageScope,
      OWNER,
      { name: 'Deck starters', slideIds: [sC, sA, sB] },
      { actorEmail: OWNER },
    );
    assert.equal(created.ok, true);
    collectionId = created.item.id;
  });

  /**
   * Make the membership table refuse `poison`, for the duration of one call.
   * `ALTER TABLE` is a utility statement, so the id goes in as a literal:
   * PostgreSQL takes no bind parameters here.
   */
  async function withRefusedMember(run) {
    await sql`
      ALTER TABLE slide_collection_items
      ADD CONSTRAINT tmp_no_poison
      CHECK (slide_library_id <> ${sql.lit(poison)}::uuid)
    `.execute(db);
    try {
      await run();
    } finally {
      await sql`
        ALTER TABLE slide_collection_items DROP CONSTRAINT tmp_no_poison
      `.execute(db);
    }
  }

  async function memberIds() {
    const item = await getPersonalCollection(storageScope, OWNER, collectionId);
    return item?.slideIds ?? null;
  }

  it('leaves the old members, in their old order, when the insert fails', async () => {
    await withRefusedMember(async () => {
      await assert.rejects(() =>
        updatePersonalCollection(
          storageScope,
          OWNER,
          collectionId,
          { slideIds: [sB, poison, sA] },
          { actorEmail: OWNER },
        ),
      );
    });

    assert.deepEqual(
      await memberIds(),
      [sC, sA, sB],
      'the replacement rolled back, so the collection still holds its slides in order',
    );
  });

  it('leaves the old members when emptying the collection fails', async () => {
    // A replacement that *would* clear the collection must not clear it either
    // when it cannot complete. The refused member is what makes it fail.
    await withRefusedMember(async () => {
      await assert.rejects(() =>
        updatePersonalCollection(
          storageScope,
          OWNER,
          collectionId,
          { slideIds: [poison] },
          { actorEmail: OWNER },
        ),
      );
    });

    assert.deepEqual(await memberIds(), [sC, sA, sB]);
  });

  /** The metadata half of the same update, straight from the row. */
  async function metadata() {
    return db
      .selectFrom('slide_collections')
      .select(['name', 'description', 'updated_at'])
      .where('id', '=', collectionId)
      .executeTakeFirstOrThrow();
  }

  it('leaves the metadata untouched when the replacement fails (B372)', async () => {
    // The rename used to be stamped *before* the membership swap, in a write of
    // its own that `replaceMembership`'s transaction cannot roll back. The
    // caller saw an error while the collection had quietly been renamed — and
    // carried a fresh `updated_at` to say so. Metadata now follows the
    // replacement, so a refused insert leaves the whole update unapplied.
    const before = await metadata();

    await withRefusedMember(async () => {
      await assert.rejects(() =>
        updatePersonalCollection(
          storageScope,
          OWNER,
          collectionId,
          {
            name: 'Renamed mid-failure',
            description: 'and re-described',
            slideIds: [sB, poison, sA],
          },
          { actorEmail: OWNER },
        ),
      );
    });

    assert.deepEqual(
      await metadata(),
      before,
      'name, description and updated_at are untouched behind the error',
    );
    assert.deepEqual(await memberIds(), [sC, sA, sB]);
  });

  it('applies the metadata when the replacement succeeds', async () => {
    const updated = await updatePersonalCollection(
      storageScope,
      OWNER,
      collectionId,
      { name: 'Renamed', description: 'and re-described', slideIds: [sA] },
      { actorEmail: OWNER },
    );
    assert.equal(updated.ok, true);
    assert.equal(updated.item.name, 'Renamed');
    assert.equal(updated.item.description, 'and re-described');
    assert.deepEqual(updated.item.slideIds, [sA]);

    const stored = await metadata();
    assert.equal(stored.name, 'Renamed');
    assert.equal(stored.description, 'and re-described');
  });

  it('still replaces the membership when nothing refuses it', async () => {
    const updated = await updatePersonalCollection(
      storageScope,
      OWNER,
      collectionId,
      { slideIds: [sB, poison, sA] },
      { actorEmail: OWNER },
    );
    assert.equal(updated.ok, true);
    assert.deepEqual(updated.item.slideIds, [sB, poison, sA]);
    assert.deepEqual(await memberIds(), [sB, poison, sA]);
  });
});
