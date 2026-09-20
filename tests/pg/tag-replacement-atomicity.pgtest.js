/**
 * Replacing a row's tags is all-or-nothing (B343), against real PostgreSQL.
 *
 * `replaceTagLinks` — the one path behind `setTagsForSlideLibraryItem` and
 * `setTagsForPresentation` (D184) — used to be two copies of a loose statement
 * sequence: delete every link, then get-or-create the tags, then insert the new
 * links. The delete landed on its own. Anything that failed after it (a
 * connection that dropped, a unique-index race on a tag being created twice,
 * a constraint) left the row with **no tags at all** — the old ones gone, the
 * new ones never written, and no error path that put them back.
 *
 * The property pinned here is that a failure after the delete rolls the whole
 * replacement back: the call rejects and the previous tags are still there.
 *
 * **How the failure is forced.** The test adds a CHECK constraint to the link
 * table that refuses one specific tag id, then asks for a replacement that
 * includes that tag. The failure therefore lands on the final link insert —
 * exactly the statement whose loose form caused the data loss — and it is
 * forced at the database, not through application input, so it survives any
 * later change to how tag names are validated. Without the transaction both
 * cases below leave the row untagged.
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
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPersonalLibraryItem,
  setTagsForSlideLibraryItem,
} from '../../server/storage/slide-library.js';
import {
  createTag,
  setTagsForPresentation,
} from '../../server/storage/tags.js';

const storageScope = testScope();
const OWNER = 'owner@example.com';

pgDescribe('replacing tags is atomic (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let libraryItem;
  let presentationId;
  let poison;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(
      db,
      'slide_library',
      'presentations',
      'tags',
      'users',
      'organizations',
    );
    await seedDefaultOrganization(db);

    libraryItem = (
      await createPersonalLibraryItem(
        storageScope,
        OWNER,
        { name: 'Mine', slideType: 'content-slide', content: {} },
        { actorEmail: OWNER },
      )
    ).item;
    presentationId = await seedPresentation(db);

    // The tag whose link the database will refuse, created up front so the
    // constraint below can name its id.
    poison = await createTag(storageScope, 'poison');

    await setTagsForSlideLibraryItem(
      storageScope,
      { id: libraryItem.id, shelf: libraryItem.shelf },
      ['original'],
      { actorEmail: OWNER },
    );
    await setTagsForPresentation(storageScope, presentationId, ['original']);
  });

  /**
   * Make the link table refuse `poison`, for the duration of one call.
   * `ALTER TABLE` is a utility statement, so the id goes in as a literal:
   * PostgreSQL takes no bind parameters here.
   */
  async function withRefusedLink(table, run) {
    await sql`
      ALTER TABLE ${sql.ref(table)}
      ADD CONSTRAINT tmp_no_poison CHECK (tag_id <> ${sql.lit(poison.id)}::uuid)
    `.execute(db);
    try {
      await run();
    } finally {
      await sql`
        ALTER TABLE ${sql.ref(table)} DROP CONSTRAINT tmp_no_poison
      `.execute(db);
    }
  }

  async function linkedNames(table, column, id) {
    const rows = await db
      .selectFrom('tags')
      .innerJoin(table, 'tags.id', `${table}.tag_id`)
      .select('tags.name')
      .where(`${table}.${column}`, '=', id)
      .orderBy('tags.name', 'asc')
      .execute();
    return rows.map((r) => r.name);
  }

  it('leaves a library item its old tags when the link insert fails', async () => {
    await withRefusedLink('slide_library_tags', async () => {
      await assert.rejects(() =>
        setTagsForSlideLibraryItem(
          storageScope,
          { id: libraryItem.id, shelf: libraryItem.shelf },
          ['keeper', 'poison'],
          { actorEmail: OWNER },
        ),
      );
    });

    assert.deepEqual(
      await linkedNames(
        'slide_library_tags',
        'slide_library_id',
        libraryItem.id,
      ),
      ['original'],
      'the replacement rolled back, so the item still carries its old tags',
    );
  });

  it('leaves a presentation its old tags when the link insert fails', async () => {
    await withRefusedLink('presentation_tags', async () => {
      await assert.rejects(() =>
        setTagsForPresentation(storageScope, presentationId, [
          'keeper',
          'poison',
        ]),
      );
    });

    assert.deepEqual(
      await linkedNames('presentation_tags', 'presentation_id', presentationId),
      ['original'],
      'the replacement rolled back, so the deck still carries its old tags',
    );
  });

  it('still replaces the tags when nothing refuses them', async () => {
    const tags = await setTagsForSlideLibraryItem(
      storageScope,
      { id: libraryItem.id, shelf: libraryItem.shelf },
      ['keeper', 'poison'],
      { actorEmail: OWNER },
    );
    assert.equal(tags.ok, true);
    assert.deepEqual(
      await linkedNames(
        'slide_library_tags',
        'slide_library_id',
        libraryItem.id,
      ),
      ['keeper', 'poison'],
    );
  });
});
