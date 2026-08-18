/**
 * Image favorites against real PostgreSQL, through the image-library facade.
 *
 * The favorite row's PRIMARY KEY is the composite `(image_id, user_email,
 * organization_id)` (migration 033), and `image_id` is a NOT NULL FK to
 * `image_library(id)`. A real database is what proves the FK-bound favorite is
 * cascaded away when its image is deleted.
 *
 * B79/D34 folded the favorites logic into the facade
 * (server/storage/image-library/index.js); the granular add/is/remove helpers
 * are now private. `toggleImageFavorite` read-guards duplicates, so the
 * `insert … ON CONFLICT DO NOTHING` inside the private `addFavorite` is a
 * concurrency guard (two racing toggles) that is not serially reachable through
 * the public surface — it is no longer exercised by a direct double-add here.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedImageLibraryItem } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  getImageFavorites,
  toggleImageFavorite,
} from '../../server/storage/image-library/index.js';

const storageScope = testScope();
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

pgDescribe('image favorites (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let imageId;

  const countFor = async (email) => {
    const row = await db
      .selectFrom('image_library_favorites')
      .select(db.fn.countAll().as('n'))
      .where('user_email', '=', email)
      .executeTakeFirst();
    return Number(row.n);
  };

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    imageId = await seedImageLibraryItem(db);
  });

  it('adds a favorite and reads it back', async () => {
    assert.equal(await toggleImageFavorite(storageScope, imageId, ALICE), true);

    assert.deepEqual(await getImageFavorites(storageScope, ALICE), [imageId]);
    assert.equal(await countFor(ALICE), 1);
  });

  it('toggling an already-favorited image off leaves no duplicate rows', async () => {
    await toggleImageFavorite(storageScope, imageId, ALICE);
    // A second toggle removes rather than inserting a duplicate; the composite
    // PK is never doubled.
    assert.equal(await toggleImageFavorite(storageScope, imageId, ALICE), false);

    assert.equal(await countFor(ALICE), 0, 'no favorite rows remain');
  });

  it('keeps favorites per user', async () => {
    await toggleImageFavorite(storageScope, imageId, ALICE);

    assert.deepEqual(await getImageFavorites(storageScope, BOB), [], "Bob sees none of Alice's");
    assert.deepEqual(await getImageFavorites(storageScope, ALICE), [imageId]);
  });

  it('toggles on and off through the facade', async () => {
    assert.equal(await toggleImageFavorite(storageScope, imageId, ALICE), true);
    assert.deepEqual(await getImageFavorites(storageScope, ALICE), [imageId]);

    assert.equal(await toggleImageFavorite(storageScope, imageId, ALICE), false);
    assert.deepEqual(await getImageFavorites(storageScope, ALICE), []);
    assert.equal(await countFor(ALICE), 0);
  });

  it('cascades favorites away when the image is deleted (FK CASCADE)', async () => {
    await toggleImageFavorite(storageScope, imageId, ALICE);

    await db.deleteFrom('image_library').where('id', '=', imageId).execute();
    assert.equal(await countFor(ALICE), 0, 'the favorite is cascaded out');
  });
});
