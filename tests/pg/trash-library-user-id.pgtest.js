/**
 * The dual-key write + authz path for trash and the slide library (T10, PR F2).
 *
 * Migration 070 adds `trashed_by_user_id` to `presentations` and
 * `created_by_user_id`/`updated_by_user_id` to `slide_library` and
 * `slide_collections`, and the PostgreSQL adapters now stamp them via the
 * identity resolver. This file pins, against real PostgreSQL:
 *
 *   - **soft-delete** stamps `trashed_by_user_id` (a known trasher writes their
 *     stable `users.id`, an external one writes NULL) and **restore** clears
 *     both halves; `listTrashedPresentations` surfaces `trashedById`;
 *   - **slide-library / collection create** stamp `created_by_user_id` and
 *     `updated_by_user_id` from the actor, NULL for an external actor;
 *   - the behaviour this PR is *for*: after the actor renames, the authz
 *     comparison the routes run (shared/identity-match.js) still matches by the
 *     stable id, where the old raw-lowercased-email compare would have failed.
 *
 * The comparison itself is pure and unit-tested; what needs a real database is
 * that the id columns are actually populated by the write path and survive a
 * rename. That is what these combine: the facade's stored output fed to the
 * exact matcher the routes call.
 *
 * Runs only against a throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 *
 * Run with: DATABASE_URL=… npm run test:pg
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
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPresentation,
  deletePresentation,
  listTrashedPresentations,
  restorePresentation,
  getPresentation,
} from '../../server/storage/presentations/index.js';
import {
  createTeamLibraryItem,
  getTeamLibraryItem,
} from '../../server/storage/slide-library/index.js';
import {
  createTeamCollection,
  getTeamCollection,
} from '../../server/storage/collections/index.js';
import { isOwnerOrCreator, matchesIdentity } from '../../shared/identity-match.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

const ORG = getDefaultOrganizationId();
const storageScope = testScope();

const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const ALICE = 'alice@example.com';
const ALICE_RENAMED = 'alice.renamed@example.com';
const EXTERNAL = 'nobody@external.test'; // deliberately NOT in `users`

pgDescribe('trash + slide-library user_id dual-key (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'slide_collections', 'slide_library', 'presentations', 'organizations');
    await seedDefaultOrganization(db);
    await db
      .insertInto('users')
      .values([{ id: ALICE_ID, organization_id: ORG, email: ALICE, name: 'Alice', role: 'user' }])
      .execute();
  });

  /** Rename Alice's account, as a real rename does. */
  async function renameAlice() {
    await db.updateTable('users').set({ email: ALICE_RENAMED }).where('id', '=', ALICE_ID).execute();
  }

  // --- trash -----------------------------------------------------------------

  it('soft-delete stamps trashed_by_user_id and listTrashed surfaces it', async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: ALICE });
    await deletePresentation(storageScope, pres.id, { actorEmail: ALICE });

    const row = await db
      .selectFrom('presentations')
      .select(['trashed_by', 'trashed_by_user_id'])
      .where('id', '=', pres.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.trashed_by, ALICE);
    assert.equal(row.trashed_by_user_id, ALICE_ID);

    const [item] = await listTrashedPresentations(storageScope);
    assert.equal(item.trashedBy, ALICE);
    assert.equal(item.trashedById, ALICE_ID, 'the trash list surfaces the id half');
  });

  it('an external trasher stamps a NULL id, not a failure', async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: ALICE });
    await deletePresentation(storageScope, pres.id, { actorEmail: EXTERNAL });

    const row = await db
      .selectFrom('presentations')
      .select(['trashed_by', 'trashed_by_user_id'])
      .where('id', '=', pres.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.trashed_by, EXTERNAL);
    assert.equal(row.trashed_by_user_id, null);
  });

  it('restore clears both halves of the dual key', async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: ALICE });
    await deletePresentation(storageScope, pres.id, { actorEmail: ALICE });
    await restorePresentation(storageScope, pres.id);

    const restored = await getPresentation(storageScope, pres.id);
    assert.equal(restored.trashedBy, null);
    assert.equal(restored.trashedById, null, 'no stale trasher id survives a restore');
  });

  it('a renamed trasher still matches by id where the raw e-mail no longer would', async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: ALICE });
    await deletePresentation(storageScope, pres.id, { actorEmail: ALICE });
    const [item] = await listTrashedPresentations(storageScope);

    await renameAlice();
    const renamed = { id: ALICE_ID, email: ALICE_RENAMED };

    // The stamped e-mail is now stale, so the pre-F2 raw compare fails…
    assert.notEqual(item.trashedBy.toLowerCase(), ALICE_RENAMED);
    // …but the id half keeps the trasher's restore/visibility right.
    assert.equal(
      matchesIdentity(renamed, { userId: item.trashedById, email: item.trashedBy }),
      true
    );
    // And owner/creator likewise survive the rename (isOwnerOrCreator, id-first).
    assert.equal(isOwnerOrCreator(renamed, item), true);
  });

  // --- slide library ---------------------------------------------------------

  it('team-library create stamps created_by_user_id and updated_by_user_id', async () => {
    const r = await createTeamLibraryItem(
      storageScope,
      { name: 'Shelf item', slideType: 'title-slide' },
      { actorEmail: ALICE }
    );
    assert.equal(r.ok, true);
    assert.equal(r.item.createdById, ALICE_ID);
    assert.equal(r.item.updatedById, ALICE_ID);

    const row = await db
      .selectFrom('slide_library')
      .select(['created_by', 'created_by_user_id', 'updated_by_user_id'])
      .where('id', '=', r.item.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.created_by, ALICE);
    assert.equal(row.created_by_user_id, ALICE_ID);
    assert.equal(row.updated_by_user_id, ALICE_ID);
  });

  it('an external library author stamps a NULL id', async () => {
    const r = await createTeamLibraryItem(
      storageScope,
      { name: 'Shelf item', slideType: 'title-slide' },
      { actorEmail: EXTERNAL }
    );
    assert.equal(r.item.createdById, null);
    assert.equal(r.item.createdBy, EXTERNAL, 'the e-mail is still the fallback identifier');
  });

  it('a renamed library creator still matches by id (the team trash/delete guard)', async () => {
    const created = await createTeamLibraryItem(
      storageScope,
      { name: 'Shelf item', slideType: 'title-slide' },
      { actorEmail: ALICE }
    );
    await renameAlice();
    const renamed = { id: ALICE_ID, email: ALICE_RENAMED };

    const item = await getTeamLibraryItem(storageScope, created.item.id);
    assert.notEqual(item.createdBy.toLowerCase(), ALICE_RENAMED);
    assert.equal(matchesIdentity(renamed, { userId: item.createdById, email: item.createdBy }), true);
  });

  // --- slide collections -----------------------------------------------------

  it('team-collection create stamps created_by_user_id, and a rename keeps the mutate right', async () => {
    const r = await createTeamCollection(storageScope, { name: 'A set' }, { actorEmail: ALICE });
    assert.equal(r.ok, true);
    assert.equal(r.item.createdById, ALICE_ID);

    const row = await db
      .selectFrom('slide_collections')
      .select(['created_by', 'created_by_user_id'])
      .where('id', '=', r.item.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.created_by, ALICE);
    assert.equal(row.created_by_user_id, ALICE_ID);

    await renameAlice();
    const renamed = { id: ALICE_ID, email: ALICE_RENAMED };
    const collection = await getTeamCollection(storageScope, r.item.id);
    assert.notEqual(collection.createdBy.toLowerCase(), ALICE_RENAMED);
    assert.equal(
      matchesIdentity(renamed, { userId: collection.createdById, email: collection.createdBy }),
      true
    );
  });
});
