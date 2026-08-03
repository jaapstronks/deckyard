/**
 * Image favorites against real PostgreSQL, through the PostgreSQL adapter.
 *
 * `addImageFavorite` inserts with ON CONFLICT DO NOTHING
 * (server/storage/adapters/postgres/image-favorites.js). The conflict target is
 * the whole composite PRIMARY KEY `(image_id, user_email, organization_id)`
 * (migration 033), and `image_id` is a NOT NULL FK to `image_library(id)`.
 * A real database is what proves that:
 *  - a duplicate add is a silent no-op (the `DO NOTHING`) rather than a unique
 *    violation — the double never enforced the key, so it could not surface it;
 *  - the favorite row is FK-bound to a real image, so deleting the image
 *    cascades the favorite away.
 *
 * The facade (`toggleImageFavorite`) guards duplicates with a read-first check,
 * so the `DO NOTHING` path is only reachable by calling the adapter's
 * `addImageFavorite` twice — done directly here, with the facade wired up in
 * `STORAGE_MODE=postgres`.
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
import { getStorage } from '../../server/storage/adapters/index.js';
import {
  getImageFavorites,
  toggleImageFavorite,
} from '../../server/storage/image-library/index.js';

const scope = testScope();
const ctx = testScope();
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

pgDescribe('image favorites (real PostgreSQL, via adapter)', () => {
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
    const storage = getStorage();
    assert.equal(await storage.addImageFavorite(imageId, ALICE, ctx), true);

    assert.deepEqual(await getImageFavorites(scope, ALICE), [imageId]);
    assert.equal(await countFor(ALICE), 1);
  });

  it('treats a duplicate add as a silent no-op (ON CONFLICT DO NOTHING)', async () => {
    const storage = getStorage();
    await storage.addImageFavorite(imageId, ALICE, ctx);
    // The second add hits the composite PK; DO NOTHING means no throw, no dup.
    await storage.addImageFavorite(imageId, ALICE, ctx);

    assert.equal(await countFor(ALICE), 1, 'still exactly one favorite row');
  });

  it('keeps favorites per user', async () => {
    const storage = getStorage();
    await storage.addImageFavorite(imageId, ALICE, ctx);

    assert.deepEqual(await getImageFavorites(scope, BOB), [], "Bob sees none of Alice's");
    assert.deepEqual(await getImageFavorites(scope, ALICE), [imageId]);
  });

  it('toggles on and off through the facade', async () => {
    assert.equal(await toggleImageFavorite(scope, imageId, ALICE), true);
    assert.deepEqual(await getImageFavorites(scope, ALICE), [imageId]);

    assert.equal(await toggleImageFavorite(scope, imageId, ALICE), false);
    assert.deepEqual(await getImageFavorites(scope, ALICE), []);
    assert.equal(await countFor(ALICE), 0);
  });

  it('cascades favorites away when the image is deleted (FK CASCADE)', async () => {
    const storage = getStorage();
    await storage.addImageFavorite(imageId, ALICE, ctx);

    await db.deleteFrom('image_library').where('id', '=', imageId).execute();
    assert.equal(await countFor(ALICE), 0, 'the favorite is cascaded out');
  });
});
