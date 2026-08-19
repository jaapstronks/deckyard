/**
 * Version snapshots are identity-clean, and restore takes identity from the
 * living deck (T10, PR D).
 *
 * Two halves, both of which need a real database:
 *
 *  - **Writing.** The snapshot is one jsonb bag in
 *    `presentation_versions.presentation_data`. What is actually stored there
 *    is only observable by reading the column back, and the fake double does
 *    not round-trip jsonb the way PostgreSQL does.
 *  - **Restoring.** Restore is `updatePresentation(storageScope, id, snapshot, …)`,
 *    which reaches the adapter's partial-write SET clause — the exact path the
 *    pg suite exists for (tests/pg/helpers/harness.js). The interesting case is
 *    an **old** row, written before this PR, that still carries identity in its
 *    embedded copy: restoring it must not hand the deck back to whoever owned
 *    it then. That is pinned here with a real ownership transfer in between.
 *
 * Both restore paths named in the brief read `version.presentation`:
 * `routes/api/presentations/restore.js` (which writes it back through
 * `updatePresentation`) and the versions route's detail/export/compare handlers
 * (which only read `presentation.slides` and hand it to the client). The write
 * one is exercised here through the same facade call the route makes; the read
 * ones are pinned by asserting the slides survive the strip.
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
  createPresentationVersion,
  getPresentation,
  getPresentationVersion,
  listPresentationVersions,
  updatePresentation,
} from '../../server/storage/presentations/index.js';
import { transferPresentationOwnership } from '../../server/storage/presentations/ownership.js';
import { SNAPSHOT_IDENTITY_FIELDS } from '../../server/storage/presentations/snapshot-identity.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

const storageScope = testScope();
const ORG = getDefaultOrganizationId();

const DECK_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const ALICE = 'alice@example.com';
const BOB_ID = '22222222-2222-2222-2222-222222222222';
const BOB = 'bob@example.com';

const SLIDES_THEN = [
  { id: 's1', type: 'title-slide', content: { title: 'Then' } },
];
const SLIDES_NOW = [
  { id: 's1', type: 'title-slide', content: { title: 'Now' } },
  { id: 's2', type: 'content-slide', content: { title: 'Added later' } },
];

pgDescribe('version snapshots are identity-clean (real PostgreSQL)', () => {
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
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    await db
      .insertInto('users')
      .values([
        {
          id: ALICE_ID,
          organization_id: ORG,
          email: ALICE,
          name: 'Alice',
          role: 'user',
        },
        {
          id: BOB_ID,
          organization_id: ORG,
          email: BOB,
          name: 'Bob',
          role: 'user',
        },
      ])
      .execute();
    await db
      .insertInto('presentations')
      .values({
        id: DECK_ID,
        organization_id: ORG,
        title: 'Deck',
        owner_email: ALICE,
        owner_user_id: ALICE_ID,
        created_by: ALICE,
        created_by_user_id: ALICE_ID,
        updated_by: ALICE,
        updated_by_user_id: ALICE_ID,
        slides: JSON.stringify(SLIDES_NOW),
      })
      .execute();
  });

  /** The raw stored snapshot bag for a version row. */
  async function storedSnapshot(versionId) {
    const row = await db
      .selectFrom('presentation_versions')
      .select('presentation_data')
      .where('id', '=', versionId)
      .executeTakeFirstOrThrow();
    return row.presentation_data;
  }

  /** Insert a version row the pre-PR way: identity embedded in the bag. */
  async function seedLegacySnapshot() {
    const row = await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: DECK_ID,
        organization_id: ORG,
        created_by: ALICE,
        reason: 'manual',
        label: 'before this PR',
        revision: 1,
        title: 'Deck as it was',
        presentation_data: JSON.stringify({
          id: DECK_ID,
          organizationId: ORG,
          title: 'Deck as it was',
          revision: 1,
          slides: SLIDES_THEN,
          // The stamps this PR removes — a snapshot taken while Alice owned it.
          ownerId: ALICE_ID,
          ownerEmail: ALICE,
          createdById: ALICE_ID,
          createdBy: ALICE,
          updatedById: ALICE_ID,
          updatedBy: ALICE,
        }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  it('a new snapshot stores no identity field', async () => {
    const pres = await getPresentation(storageScope, DECK_ID);
    assert.equal(pres.ownerEmail, ALICE, 'the live deck does carry identity');

    const created = await createPresentationVersion(
      storageScope,
      DECK_ID,
      pres,
      {
        actorEmail: ALICE,
        reason: 'manual',
        label: 'checkpoint',
      },
    );

    const bag = await storedSnapshot(created.id);
    for (const field of SNAPSHOT_IDENTITY_FIELDS) {
      assert.equal(
        field in bag,
        false,
        `${field} must not be embedded in the snapshot`,
      );
    }
    // And the content a restore consumes is all still there.
    assert.equal(bag.title, 'Deck');
    assert.deepEqual(bag.slides, SLIDES_NOW);
  });

  it('who took the snapshot is still recorded, in its own dual-keyed column', async () => {
    const pres = await getPresentation(storageScope, DECK_ID);
    const created = await createPresentationVersion(
      storageScope,
      DECK_ID,
      pres,
      {
        actorEmail: ALICE,
        reason: 'manual',
      },
    );

    // `created_by` is a first-class column, not part of the embedded copy: the
    // version list renders it. Stripping the bag must not have taken it too.
    // Since T10 PR F1 it carries a stable `users.id` beside the e-mail; both
    // halves are stamped from one resolution of the acting user's address.
    // Since D22 the *response* renders that pair as `{ id, displayName }` —
    // the id half is the same value, the address stays server-side.
    const [summary] = await listPresentationVersions(storageScope, DECK_ID);
    assert.equal(
      summary.createdBy?.id,
      ALICE_ID,
      'the version author id is stamped',
    );
    assert.equal(summary.createdBy?.displayName, 'Alice');
    assert.equal(
      created.createdBy?.id,
      ALICE_ID,
      'and returned from the create call',
    );

    // Pin the actual stored column, not just the mapped shape.
    const row = await db
      .selectFrom('presentation_versions')
      .select('created_by_user_id')
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.created_by_user_id, ALICE_ID);
  });

  it('an external snapshot author (no users row) stamps a NULL id, not a failure', async () => {
    const pres = await getPresentation(storageScope, DECK_ID);
    const created = await createPresentationVersion(
      storageScope,
      DECK_ID,
      pres,
      {
        actorEmail: 'stranger@example.com',
        reason: 'manual',
      },
    );

    const [summary] = await listPresentationVersions(storageScope, DECK_ID);
    assert.equal(
      summary.createdBy?.displayName,
      'Stranger',
      'the external author is still named, from the stored address',
    );
    assert.equal(
      summary.createdBy?.id,
      null,
      'and the id half is a defined NULL (external)',
    );
    assert.equal(created.createdBy?.id, null);

    // The address itself is in the column, not in the response (D22).
    const row = await db
      .selectFrom('presentation_versions')
      .select('created_by')
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.created_by, 'stranger@example.com');
  });

  it('snapshotting does not strip the live deck', async () => {
    const pres = await getPresentation(storageScope, DECK_ID);
    await createPresentationVersion(storageScope, DECK_ID, pres, {
      actorEmail: ALICE,
      reason: 'manual',
    });

    // The caller's object is often a cache entry and is used again after the
    // snapshot (the restore route answers its request from it).
    assert.equal(pres.ownerEmail, ALICE);
    assert.equal(
      (await getPresentation(storageScope, DECK_ID)).ownerEmail,
      ALICE,
    );
  });

  it('restoring an identity-bearing legacy snapshot does not move ownership back', async () => {
    const versionId = await seedLegacySnapshot();

    // The deck changes hands after that snapshot was taken.
    const transfer = await transferPresentationOwnership(
      storageScope,
      DECK_ID,
      { newOwnerEmail: BOB, actorEmail: ALICE, keepAsCollaborator: false },
    );
    assert.equal(transfer.ok, true, 'the transfer landed');
    assert.equal(
      (await getPresentation(storageScope, DECK_ID)).ownerEmail,
      BOB,
    );

    // Restore, exactly as routes/api/presentations/restore.js does it.
    const version = await getPresentationVersion(
      storageScope,
      DECK_ID,
      versionId,
    );
    assert.equal(
      version.presentation.ownerEmail,
      ALICE,
      'the old bag really does carry Alice',
    );

    const before = await getPresentation(storageScope, DECK_ID);
    await updatePresentation(storageScope, DECK_ID, version.presentation, {
      expectedRevision: before.revision,
      actorEmail: BOB,
      restoreFromVersionId: versionId,
      reason: 'restore',
    });

    const after = await getPresentation(storageScope, DECK_ID);
    // Restore moves slides, not ownership: identity is re-derived from the
    // living deck simply by not being consumed from the body.
    assert.equal(
      after.ownerEmail,
      BOB,
      'the deck did not hand itself back to Alice',
    );
    assert.equal(after.ownerId, BOB_ID);
    assert.equal(
      after.createdBy,
      ALICE,
      'who made it is create-only and unchanged',
    );
    assert.equal(
      after.updatedBy?.id,
      BOB_ID,
      'the restorer is the last writer',
    );
    // Slide shape, not object identity: the write path normalizes slides (it
    // fills `parentId`), so compare what the restore was for.
    assert.deepEqual(
      after.slides.map((s) => [s.id, s.content.title]),
      [['s1', 'Then']],
      'and the slides did come back',
    );
  });

  it('restoring a stripped snapshot behaves identically', async () => {
    // The same restore, on a snapshot written the new way. This is the
    // behaviour-preservation half: stripping must change nothing observable.
    const pres = await getPresentation(storageScope, DECK_ID);
    const created = await createPresentationVersion(
      storageScope,
      DECK_ID,
      { ...pres, slides: SLIDES_THEN, title: 'Deck as it was' },
      { actorEmail: ALICE, reason: 'manual' },
    );

    await transferPresentationOwnership(storageScope, DECK_ID, {
      newOwnerEmail: BOB,
      actorEmail: ALICE,
      keepAsCollaborator: false,
    });

    const version = await getPresentationVersion(
      storageScope,
      DECK_ID,
      created.id,
    );
    const before = await getPresentation(storageScope, DECK_ID);
    await updatePresentation(storageScope, DECK_ID, version.presentation, {
      expectedRevision: before.revision,
      actorEmail: BOB,
      restoreFromVersionId: created.id,
      reason: 'restore',
    });

    const after = await getPresentation(storageScope, DECK_ID);
    assert.equal(after.ownerEmail, BOB);
    assert.equal(after.ownerId, BOB_ID);
    assert.equal(after.createdBy, ALICE);
    assert.equal(after.updatedBy?.id, BOB_ID);
    assert.equal(after.title, 'Deck as it was');
    assert.deepEqual(
      after.slides.map((s) => [s.id, s.content.title]),
      [['s1', 'Then']],
    );
  });

  it('the read-only version surfaces still get their slides', async () => {
    // The versions route's detail, export and compare-ai handlers all read
    // `version.presentation` (and `.slides` in particular) and hand it to the
    // client. Stripping identity must leave that intact.
    const pres = await getPresentation(storageScope, DECK_ID);
    const created = await createPresentationVersion(
      storageScope,
      DECK_ID,
      pres,
      {
        actorEmail: ALICE,
        reason: 'manual',
      },
    );

    const version = await getPresentationVersion(
      storageScope,
      DECK_ID,
      created.id,
    );
    assert.deepEqual(version.presentation.slides, SLIDES_NOW);
    assert.equal(version.title, 'Deck');
    assert.equal(version.createdBy?.id, ALICE_ID);
  });
});
