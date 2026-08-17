/**
 * Slide collections against real PostgreSQL, through the storage facade.
 *
 * The PostgreSQL counterpart of tests/slide-collections-storage.test.js. Same
 * facade (server/storage/collections/index.js), same concerns — personal
 * CRUD + ordered membership, personal shelf isolation, team create/list and the
 * creator/admin mutate guard — but on the backend PR G keeps.
 *
 * One real difference the file backend could not show: `slide_collection_items`
 * foreign-keys `slide_library_id`, and the adapter *filters membership to slide
 * ids that actually exist in the org* (postgres/collections.js
 * `filterExistingSlideIds`). The file suite passed bare `'s1'` strings that were
 * stored verbatim; here membership is seeded slide-library uuids, and a final
 * test pins the FK guard the fake-db never models.
 */

import { after, before, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedSlideLibraryItem } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  listPersonalCollections,
  getPersonalCollection,
  createPersonalCollection,
  updatePersonalCollection,
  deletePersonalCollection,
  listTeamCollections,
  createTeamCollection,
  updateTeamCollection,
  deleteTeamCollection,
} from '../../server/storage/collections/index.js';

const storageScope = testScope();
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

pgDescribe('slide collections (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  // Real slide-library uuids standing in for the file suite's 's1'/'a'/'t1'.
  let sA;
  let sB;
  let sC;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    sA = await seedSlideLibraryItem(db, { name: 'A' });
    sB = await seedSlideLibraryItem(db, { name: 'B' });
    sC = await seedSlideLibraryItem(db, { name: 'C' });
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  // --- personal collections ---

  it('creates, lists and gets a collection with an ordered membership', async () => {
    const created = await createPersonalCollection(
      storageScope,
      ALICE,
      { name: 'Intro deck', description: 'Onboarding', slideIds: [sA, sB, sC] },
      { actorEmail: ALICE }
    );
    assert.ok(created.ok, 'create ok');
    assert.strictEqual(created.item.shelf, 'personal');
    assert.strictEqual(created.item.ownerEmail, ALICE);
    assert.strictEqual(created.item.slideCount, 3);
    assert.deepStrictEqual(created.item.slideIds, [sA, sB, sC]);

    const { items } = await listPersonalCollections(storageScope, ALICE);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, created.item.id);

    const fetched = await getPersonalCollection(storageScope, ALICE, created.item.id);
    assert.ok(fetched, 'fetched by id');
    assert.strictEqual(fetched.name, 'Intro deck');
  });

  it('rejects a collection with no name', async () => {
    const r = await createPersonalCollection(storageScope, ALICE, { name: '  ' }, { actorEmail: ALICE });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'name_required');
  });

  it('replaces the ordered membership on update and dedupes', async () => {
    const created = await createPersonalCollection(
      storageScope,
      ALICE,
      { name: 'Reorder me', slideIds: [sA, sB] },
      { actorEmail: ALICE }
    );
    const updated = await updatePersonalCollection(
      storageScope,
      ALICE,
      created.item.id,
      { slideIds: [sC, sA, sA, sB], name: 'Reordered' },
      { actorEmail: ALICE }
    );
    assert.ok(updated.ok, 'update ok');
    assert.strictEqual(updated.item.name, 'Reordered');
    // Deduped, order preserved.
    assert.deepStrictEqual(updated.item.slideIds, [sC, sA, sB]);
    assert.strictEqual(updated.item.slideCount, 3);
  });

  it('drops membership ids that reference no slide-library row (FK guard)', async () => {
    const ghost = crypto.randomUUID(); // valid uuid, no slide_library row
    const created = await createPersonalCollection(
      storageScope,
      ALICE,
      { name: 'Partly real', slideIds: [sA, ghost, sB] },
      { actorEmail: ALICE }
    );
    assert.ok(created.ok);
    // The adapter guards the join-table FK: only real ids survive, in order.
    assert.deepStrictEqual(created.item.slideIds, [sA, sB]);
    assert.strictEqual(created.item.slideCount, 2);
  });

  it('isolates personal collections between users', async () => {
    const aliceCol = await createPersonalCollection(
      storageScope,
      ALICE,
      { name: 'Private to Alice' },
      { actorEmail: ALICE }
    );

    // Bob cannot see Alice's collection in his list.
    const bobList = await listPersonalCollections(storageScope, BOB);
    assert.ok(!bobList.items.some((c) => c.id === aliceCol.item.id), 'not in Bob list');

    // Bob cannot fetch, update, or delete it.
    assert.strictEqual(await getPersonalCollection(storageScope, BOB, aliceCol.item.id), null);
    const bobUpdate = await updatePersonalCollection(
      storageScope,
      BOB,
      aliceCol.item.id,
      { name: 'hijacked' },
      { actorEmail: BOB }
    );
    assert.strictEqual(bobUpdate.ok, false);
    assert.strictEqual(bobUpdate.reason, 'not_found');
    const bobDelete = await deletePersonalCollection(storageScope, BOB, aliceCol.item.id);
    assert.strictEqual(bobDelete.ok, false);
  });

  it('deletes a collection', async () => {
    const created = await createPersonalCollection(
      storageScope,
      ALICE,
      { name: 'Temp' },
      { actorEmail: ALICE }
    );
    const del = await deletePersonalCollection(storageScope, ALICE, created.item.id);
    assert.ok(del.ok, 'delete ok');
    assert.strictEqual(await getPersonalCollection(storageScope, ALICE, created.item.id), null);
  });

  // --- team collections ---

  it('creates and lists a team collection', async () => {
    const created = await createTeamCollection(
      storageScope,
      { name: 'Team starter', slideIds: [sA] },
      { actorEmail: ALICE }
    );
    assert.ok(created.ok);
    assert.strictEqual(created.item.shelf, 'organization');
    assert.strictEqual(created.item.createdBy, ALICE);

    const { items } = await listTeamCollections(storageScope, { userEmail: BOB });
    assert.ok(items.some((c) => c.id === created.item.id), 'visible to any user');
  });

  it('enforces the mutate guard: only creator or admin', async () => {
    const created = await createTeamCollection(storageScope, { name: 'Guarded' }, { actorEmail: ALICE });
    const allowMutate = (collection, { actorEmail }) =>
      String(collection?.createdBy || '').toLowerCase() === String(actorEmail || '').toLowerCase();

    // Bob (non-creator, non-admin) is blocked.
    const blocked = await updateTeamCollection(
      storageScope,
      created.item.id,
      { name: 'nope' },
      { actorEmail: BOB, allowMutate }
    );
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.reason, 'forbidden');

    // Alice (creator) may mutate and delete.
    const ok = await updateTeamCollection(
      storageScope,
      created.item.id,
      { name: 'Renamed' },
      { actorEmail: ALICE, allowMutate }
    );
    assert.ok(ok.ok);
    assert.strictEqual(ok.item.name, 'Renamed');

    const del = await deleteTeamCollection(storageScope, created.item.id, { actorEmail: ALICE, allowMutate });
    assert.ok(del.ok);
  });
});
