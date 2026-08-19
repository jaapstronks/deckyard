/**
 * The identity data migration, verified per row (T10, PR G).
 *
 * Three things land here because none of them can be shown against the
 * in-memory double:
 *
 *  - **Migration 068** rewrites `presentation_versions.presentation_data` with
 *    the jsonb `-` operator. Whether a key is gone — and whether a second run
 *    touches anything — is a property of PostgreSQL's jsonb, not of a mock.
 *  - **The orphan rule** for `user_settings` exists *because* of a primary-key
 *    collision. A double that enforces no unique key cannot fail the way the
 *    real table does, so it cannot show the fix either.
 *  - **`verifyIdentityConsistency()`** is a full-table scan with two joins onto
 *    `users`. It has nothing to read unless the rows are real.
 *
 * Runs only against a throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { up as stripIdentityFromSnapshots } from '../../server/db/migrations/068_strip_identity_from_snapshots.js';
import {
  verifyIdentityConsistency,
  formatIdentityReport,
} from '../../server/storage/identity-verification.js';
import {
  getUserSettings,
  writeUserSettings,
} from '../../server/storage/settings.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';
import { testScope } from '../helpers/storage-scope.js';

const ORG = getDefaultOrganizationId();

const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const ALICE = 'alice@example.com';
const ALICE_RENAMED = 'alice.renamed@example.com';
const BOB_ID = '22222222-2222-2222-2222-222222222222';
const BOB = 'bob@example.com';
const EXTERNAL = 'nobody@example.com';

const DECK_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

/** A snapshot as the rows written before PR D (#644) carry it. */
const LEGACY_SNAPSHOT = {
  id: DECK_ID,
  title: 'A deck',
  slides: [{ id: 's1', type: 'title-slide', content: { title: 'Kept' } }],
  settings: { theme: 'amethyst' },
  ownerId: ALICE_ID,
  ownerEmail: ALICE,
  createdById: ALICE_ID,
  createdBy: ALICE,
  updatedById: ALICE_ID,
  updatedBy: ALICE,
  trashedBy: null,
};

/** Find one check in a report by its id column. */
function check(report, table, idColumn) {
  const found = report.checks.find(
    (c) => c.table === table && c.idColumn === idColumn,
  );
  assert.ok(found, `report has a check for ${table}.${idColumn}`);
  return found;
}

pgDescribe('identity data migration verification (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(
      db,
      'slide_collections',
      'slide_library',
      'presentations',
      'presentation_collaborators',
      'user_settings',
      'organizations',
    );
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
      .onConflict((oc) =>
        oc
          .column('id')
          .doUpdateSet({ email: (eb) => eb.ref('excluded.email') }),
      )
      .execute();
  });

  // ----------------------------------------------------------------
  // 1. The snapshot backfill (migration 068)
  // ----------------------------------------------------------------

  /** Seed a deck plus one identity-bearing snapshot row, as written pre-#644. */
  async function seedLegacySnapshot() {
    await db
      .insertInto('presentations')
      .values({
        id: DECK_ID,
        organization_id: ORG,
        title: 'A deck',
        owner_email: ALICE,
        owner_user_id: ALICE_ID,
        slides: JSON.stringify(LEGACY_SNAPSHOT.slides),
      })
      .execute();
    await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: DECK_ID,
        organization_id: ORG,
        created_by: ALICE,
        reason: 'snapshot',
        revision: 1,
        title: 'A deck',
        presentation_data: JSON.stringify(LEGACY_SNAPSHOT),
      })
      .execute();
  }

  /** The single snapshot row's embedded presentation object. */
  async function readSnapshot() {
    const row = await db
      .selectFrom('presentation_versions')
      .select(['presentation_data', 'created_by'])
      .executeTakeFirstOrThrow();
    return row;
  }

  it('erases every identity field from snapshots written before PR D', async () => {
    await seedLegacySnapshot();

    const before = await readSnapshot();
    assert.equal(
      before.presentation_data.ownerEmail,
      ALICE,
      'the seeded row really did carry identity',
    );

    await stripIdentityFromSnapshots(db);

    const after = await readSnapshot();
    for (const field of [
      'ownerId',
      'ownerEmail',
      'createdById',
      'createdBy',
      'updatedById',
      'updatedBy',
      'trashedBy',
    ]) {
      assert.ok(
        !(field in after.presentation_data),
        `${field} is gone from the embedded copy`,
      );
    }
  });

  it('leaves everything a restore consumes untouched', async () => {
    await seedLegacySnapshot();
    await stripIdentityFromSnapshots(db);

    const { presentation_data: data, created_by: createdBy } =
      await readSnapshot();
    assert.deepEqual(data.slides, LEGACY_SNAPSHOT.slides, 'slides survive');
    assert.deepEqual(
      data.settings,
      LEGACY_SNAPSHOT.settings,
      'settings survive',
    );
    assert.equal(data.title, 'A deck', 'title survives');
    assert.equal(data.id, DECK_ID, 'the deck id survives');
    assert.equal(
      createdBy,
      ALICE,
      'the created_by column is a separate first-class field, dual-keyed in its own right (PR F1)',
    );
  });

  it('is a no-op on the second run', async () => {
    await seedLegacySnapshot();
    await stripIdentityFromSnapshots(db);

    // xmin is PostgreSQL's own "which transaction last wrote this row". If the
    // second run rewrote anything it changes; a count-based check could not
    // tell a no-op from a rewrite that happens to produce the same values.
    const versionOf = async () => {
      const { rows } = await sql`
        SELECT xmin::text AS v FROM presentation_versions
      `.execute(db);
      return rows.map((r) => r.v);
    };

    const first = await versionOf();
    await stripIdentityFromSnapshots(db);
    const second = await versionOf();

    assert.deepEqual(second, first, 'the second run wrote no row');
  });

  it('is a no-op on rows that were already clean', async () => {
    await db
      .insertInto('presentations')
      .values({
        id: DECK_ID,
        organization_id: ORG,
        title: 'A deck',
        owner_email: ALICE,
      })
      .execute();
    await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: DECK_ID,
        organization_id: ORG,
        created_by: ALICE,
        revision: 1,
        title: 'A deck',
        presentation_data: JSON.stringify({
          id: DECK_ID,
          title: 'A deck',
          slides: [],
        }),
      })
      .execute();

    const { rows: before } =
      await sql`SELECT xmin::text AS v FROM presentation_versions`.execute(db);
    await stripIdentityFromSnapshots(db);
    const { rows: after } =
      await sql`SELECT xmin::text AS v FROM presentation_versions`.execute(db);

    assert.deepEqual(
      after.map((r) => r.v),
      before.map((r) => r.v),
      'a deck whose snapshots are already clean is not rewritten',
    );
  });

  // ----------------------------------------------------------------
  // 2. The orphan rule for user_settings
  // ----------------------------------------------------------------

  it('a rename into an address held by an orphan row keeps the id-bearing row and drops the orphan', async () => {
    // Alice has settings under her current address…
    await writeUserSettings(testScope(), ALICE, { uiLocale: 'nl' });
    // …and some id-less row already sits on the address she is about to take:
    // a legacy disk import, or an address that never became an account.
    await db
      .insertInto('user_settings')
      .values({
        email: ALICE_RENAMED,
        user_id: null,
        settings: JSON.stringify({ uiLocale: 'en-gb' }),
      })
      .execute();

    await db
      .updateTable('users')
      .set({ email: ALICE_RENAMED })
      .where('id', '=', ALICE_ID)
      .execute();

    // Before the orphan rule this threw on the e-mail primary key.
    await writeUserSettings(testScope(), ALICE_RENAMED, { uiLocale: 'nl' });

    const rows = await db
      .selectFrom('user_settings')
      .select(['email', 'user_id', 'settings'])
      .where('email', '=', ALICE_RENAMED)
      .execute();
    assert.equal(rows.length, 1, 'one row per person — the orphan is gone');
    assert.equal(
      rows[0].user_id,
      ALICE_ID,
      'the surviving row is the id-bearing one',
    );
    assert.equal(
      rows[0].settings.uiLocale,
      'nl',
      "and it carries Alice's settings, not the orphan's",
    );

    const read = await getUserSettings(testScope(), ALICE_RENAMED);
    assert.equal(read.uiLocale, 'nl', 'the rename kept her preferences');
  });

  it('an orphan row is adopted, not deleted, when its owner has no id-bearing row yet', async () => {
    // The row shape migration 059's disk import leaves behind: an address that
    // does have a users row, but a settings row that predates the backfill.
    await db
      .insertInto('user_settings')
      .values({
        email: BOB,
        user_id: null,
        settings: JSON.stringify({ uiLocale: 'en-gb' }),
      })
      .execute();

    await writeUserSettings(testScope(), BOB, {});

    const rows = await db
      .selectFrom('user_settings')
      .select(['email', 'user_id', 'settings'])
      .where('email', '=', BOB)
      .execute();
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].user_id,
      BOB_ID,
      'the legacy row picked up its id rather than being replaced',
    );
    assert.equal(
      rows[0].settings.uiLocale,
      'en-gb',
      'its stored preferences survived the adoption',
    );
  });

  it('leaves an unrelated orphan row alone', async () => {
    await writeUserSettings(testScope(), ALICE, { uiLocale: 'nl' });
    await db
      .insertInto('user_settings')
      .values({
        email: EXTERNAL,
        user_id: null,
        settings: JSON.stringify({ uiLocale: 'en-gb' }),
      })
      .execute();

    await writeUserSettings(testScope(), ALICE, { uiLocale: 'nl' });

    const row = await db
      .selectFrom('user_settings')
      .select(['email', 'user_id'])
      .where('email', '=', EXTERNAL)
      .executeTakeFirst();
    assert.ok(row, 'an orphan on a different address is not collateral damage');
    assert.equal(row.user_id, null);
  });

  // ----------------------------------------------------------------
  // 3. The per-row verification
  // ----------------------------------------------------------------

  it('reports a consistently migrated database as ok', async () => {
    await db
      .insertInto('presentations')
      .values({
        id: DECK_ID,
        organization_id: ORG,
        title: 'A deck',
        owner_email: ALICE,
        owner_user_id: ALICE_ID,
        created_by: ALICE,
        created_by_user_id: ALICE_ID,
        trashed_by: ALICE,
        trashed_by_user_id: ALICE_ID,
      })
      .execute();
    await db
      .insertInto('presentation_collaborators')
      .values({
        presentation_id: DECK_ID,
        organization_id: ORG,
        user_email: BOB,
        user_id: BOB_ID,
        permission: 'view',
      })
      .execute();
    await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: DECK_ID,
        organization_id: ORG,
        created_by: ALICE,
        created_by_user_id: ALICE_ID,
        reason: 'snapshot',
        revision: 1,
        title: 'A deck',
        presentation_data: JSON.stringify({
          id: DECK_ID,
          title: 'A deck',
          slides: [],
        }),
      })
      .execute();
    await db
      .insertInto('slide_library')
      .values({
        organization_id: ORG,
        shelf: 'organization',
        name: 'Shelf item',
        slide_type: 'title-slide',
        created_by: ALICE,
        created_by_user_id: ALICE_ID,
        updated_by: ALICE,
        updated_by_user_id: ALICE_ID,
      })
      .execute();
    await db
      .insertInto('slide_collections')
      .values({
        organization_id: ORG,
        shelf: 'organization',
        name: 'A set',
        created_by: ALICE,
        created_by_user_id: ALICE_ID,
        updated_by: ALICE,
        updated_by_user_id: ALICE_ID,
      })
      .execute();
    await writeUserSettings(testScope(), ALICE, {});

    const report = await verifyIdentityConsistency();
    assert.equal(report.ok, true, formatIdentityReport(report).join('\n'));
    assert.equal(report.mismatched, 0);
    assert.equal(check(report, 'presentations', 'owner_user_id').linked, 1);
    assert.equal(
      check(report, 'presentations', 'trashed_by_user_id').linked,
      1,
    );
    assert.equal(
      check(report, 'presentation_versions', 'created_by_user_id').linked,
      1,
    );
    assert.equal(
      check(report, 'presentation_collaborators', 'user_id').linked,
      1,
    );
    assert.equal(
      check(report, 'slide_library', 'created_by_user_id').linked,
      1,
    );
    assert.equal(
      check(report, 'slide_library', 'updated_by_user_id').linked,
      1,
    );
    assert.equal(
      check(report, 'slide_collections', 'created_by_user_id').linked,
      1,
    );
    assert.equal(check(report, 'user_settings', 'user_id').linked, 1);
  });

  it('counts an id-less row with no users row as external, not as a defect', async () => {
    await db
      .insertInto('presentations')
      .values({
        id: DECK_ID,
        organization_id: ORG,
        title: 'A deck',
        owner_email: ALICE,
        owner_user_id: ALICE_ID,
      })
      .execute();
    await db
      .insertInto('presentation_collaborators')
      .values({
        presentation_id: DECK_ID,
        organization_id: ORG,
        user_email: EXTERNAL,
        user_id: null,
        permission: 'view',
      })
      .execute();
    // The shared anonymous bucket: never a person, so never an id.
    await writeUserSettings(testScope(), '', {});

    const report = await verifyIdentityConsistency();
    assert.equal(report.ok, true, formatIdentityReport(report).join('\n'));
    assert.equal(
      check(report, 'presentation_collaborators', 'user_id').external,
      1,
    );
    assert.equal(check(report, 'user_settings', 'user_id').external, 1);
    assert.equal(
      report.unlinked,
      0,
      'external rows are not repairable — they are correct',
    );
  });

  it('flags an id-less row whose e-mail does have a users row as repairable', async () => {
    // Exactly what an un-run backfill leaves behind.
    await db
      .insertInto('presentations')
      .values({
        id: DECK_ID,
        organization_id: ORG,
        title: 'A deck',
        owner_email: ALICE,
        owner_user_id: null,
      })
      .execute();

    const report = await verifyIdentityConsistency();
    const owner = check(report, 'presentations', 'owner_user_id');
    assert.equal(owner.unlinked, 1);
    assert.equal(owner.linked, 0);
    assert.equal(
      report.ok,
      true,
      'not wrong today — the e-mail fallback still finds it',
    );
    assert.equal(report.unlinked, 1);
    assert.match(
      formatIdentityReport(report).join('\n'),
      /re-run the backfill/,
    );
  });

  it('fails on a row whose id and e-mail name two different people', async () => {
    await db
      .insertInto('presentations')
      .values({
        id: DECK_ID,
        organization_id: ORG,
        title: 'A deck',
        owner_email: BOB,
        owner_user_id: ALICE_ID,
      })
      .execute();

    const report = await verifyIdentityConsistency();
    assert.equal(report.ok, false);
    assert.equal(report.mismatched, 1);
    const owner = check(report, 'presentations', 'owner_user_id');
    assert.equal(owner.mismatched, 1);
    assert.deepEqual(owner.mismatchedSamples, [
      { email: BOB, userEmail: ALICE, userId: ALICE_ID },
    ]);
    assert.match(formatIdentityReport(report).join('\n'), /FAILED/);
  });

  it('catches the drift a rename leaves until the next write re-stamps it', async () => {
    // Alice renames. Her settings row keeps the old address in its `email`
    // column until she writes again — the exact "id present, e-mail stale"
    // state the re-stamp exists to close, and the one this check watches.
    await writeUserSettings(testScope(), ALICE, { uiLocale: 'nl' });
    await db
      .updateTable('users')
      .set({ email: ALICE_RENAMED })
      .where('id', '=', ALICE_ID)
      .execute();

    const drifted = await verifyIdentityConsistency();
    assert.equal(
      drifted.ok,
      false,
      'a stale e-mail column is a mismatch, not a shrug',
    );
    assert.equal(check(drifted, 'user_settings', 'user_id').mismatched, 1);

    await writeUserSettings(testScope(), ALICE_RENAMED, {});

    const healed = await verifyIdentityConsistency();
    assert.equal(healed.ok, true, formatIdentityReport(healed).join('\n'));
    assert.equal(check(healed, 'user_settings', 'user_id').linked, 1);
  });

  it('re-running the verification changes nothing', async () => {
    await db
      .insertInto('presentations')
      .values({
        id: DECK_ID,
        organization_id: ORG,
        title: 'A deck',
        owner_email: ALICE,
        owner_user_id: ALICE_ID,
      })
      .execute();

    const { rows: before } =
      await sql`SELECT xmin::text AS v FROM presentations`.execute(db);
    const first = await verifyIdentityConsistency();
    const second = await verifyIdentityConsistency();
    const { rows: after } =
      await sql`SELECT xmin::text AS v FROM presentations`.execute(db);

    assert.deepEqual(second, first, 'same answer');
    assert.deepEqual(
      after.map((r) => r.v),
      before.map((r) => r.v),
      'and it wrote nothing on the way to it',
    );
  });
});
