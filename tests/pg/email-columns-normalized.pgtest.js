/**
 * One fold, on the write side, for every e-mail column a read compares bare
 * (B664, D200), against real PostgreSQL.
 *
 * Before B664 these columns were stored as handed in and folded again on
 * read: `lower()` in the digest join and the identity verification, a private
 * `normalizeEmail` in the slide library, `.toLowerCase()` on the collection
 * owner. Since then the writes fold through `normalizeEmail` (shared/email.js)
 * and the reads compare bare, which is safe only once migration 092 has
 * folded the rows written before. What this pins:
 *
 *  - the migration counts and folds each column, leaves a row that would
 *    collide on a unique constraint as it is, and finds nothing on a second
 *    run;
 *  - `getUserIdByEmail` finds a user from a mixed-case address, so the
 *    `created_by` of a theme, font or custom slide type is no longer NULL for
 *    an actor whose address arrives in another spelling;
 *  - a legacy favorite and a legacy personal-shelf owner are found from a
 *    mixed-case address after the migration, and a new favorite is stored in
 *    the normalised spelling.
 *
 * The presentation stamps folded by migration 091 are pinned in
 * presentation-email-normalized.pgtest.js.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  EMAIL_COLUMNS,
  countUnnormalized,
  countUnnormalizedFavorites,
  up as normalizeEmailColumns,
} from '../../server/db/migrations/092_email_columns_normalized.js';
import { getUserIdByEmail } from '../../server/storage/utils/helpers.js';
import {
  listOrganizationLibrary,
  listPersonalLibrary,
  updateOrganizationLibraryItem,
} from '../../server/storage/slide-library.js';

const ANN = 'ann@example.com';
const LEGACY_ANN = '  Ann@Example.COM ';
const ASKED_AS = ' ANN@example.Com ';

/**
 * Run the migration the way the runner does: one transaction.
 * @param {import('kysely').Kysely<any>} db
 */
const runMigration = (db) =>
  db.transaction().execute((trx) => normalizeEmailColumns(trx));

pgDescribe('e-mail columns normalised on write (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let orgId;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(
      db,
      'organizations',
      'users',
      'user_settings',
      'slide_library',
      'slide_collections',
    );
    orgId = await seedDefaultOrganization(db);
  });

  /** Insert a user row exactly as given, bypassing the facade. */
  async function insertUser(email) {
    const id = crypto.randomUUID();
    await db
      .insertInto('users')
      .values({ id, organization_id: orgId, email, role: 'user' })
      .execute();
    return id;
  }

  /** A deck to hang versions, collaborators and sessions on. */
  async function insertDeck(trashedBy = null) {
    const id = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id,
        organization_id: orgId,
        owner_email: ANN,
        trashed_by: trashedBy,
        trashed_at: trashedBy ? new Date().toISOString() : null,
        title: 'Deck',
        slides: JSON.stringify([]),
        i18n: JSON.stringify({}),
      })
      .execute();
    return id;
  }

  /** A library item with every e-mail column in the legacy spelling. */
  async function insertLibraryItem(shelf, favorites = [LEGACY_ANN]) {
    const id = crypto.randomUUID();
    await db
      .insertInto('slide_library')
      .values({
        id,
        organization_id: orgId,
        shelf,
        name: 'Item',
        slide_type: 'text',
        content: JSON.stringify({}),
        owner_email: LEGACY_ANN,
        created_by: LEGACY_ANN,
        updated_by: LEGACY_ANN,
        favorites,
      })
      .execute();
    return id;
  }

  /** Every e-mail column of the 092 list holding the legacy spelling. */
  async function seedLegacyRows() {
    await insertUser(LEGACY_ANN);
    await db
      .insertInto('user_settings')
      .values({ email: LEGACY_ANN, settings: JSON.stringify({}) })
      .execute();
    const deck = await insertDeck(LEGACY_ANN);
    await db
      .insertInto('presentation_collaborators')
      .values({
        presentation_id: deck,
        organization_id: orgId,
        user_email: LEGACY_ANN,
        permission: 'view',
      })
      .execute();
    await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: deck,
        organization_id: orgId,
        created_by: LEGACY_ANN,
        revision: 1,
        presentation_data: JSON.stringify({}),
      })
      .execute();
    const item = await insertLibraryItem('organization');
    await db
      .updateTable('slide_library')
      .set({ trashed_by: LEGACY_ANN })
      .where('id', '=', item)
      .execute();
    await db
      .insertInto('slide_collections')
      .values({
        organization_id: orgId,
        shelf: 'personal',
        name: 'Collection',
        owner_email: LEGACY_ANN,
        created_by: LEGACY_ANN,
        updated_by: LEGACY_ANN,
      })
      .execute();
    const at = new Date().toISOString();
    await db
      .insertInto('view_sessions')
      .values({
        presentation_id: deck,
        session_token: crypto.randomBytes(32).toString('hex'),
        source_type: 'share_link',
        viewer_type: 'authenticated',
        viewer_email: LEGACY_ANN,
        device_id: crypto.randomUUID(),
        started_at: at,
        last_activity_at: at,
      })
      .execute();
  }

  describe('migration 092', () => {
    it('counts and folds every column, once', async () => {
      await seedLegacyRows();
      for (const spec of EMAIL_COLUMNS) {
        assert.deepEqual(
          await countUnnormalized(db, spec),
          { unnormalized: 1, foldable: 1 },
          `${spec.table}.${spec.column}`,
        );
      }
      assert.equal(await countUnnormalizedFavorites(db), 1);

      await runMigration(db);

      for (const { table, column } of EMAIL_COLUMNS) {
        const rows = await db.selectFrom(table).select(column).execute();
        assert.deepEqual(
          rows.map((r) => r[column]),
          [ANN],
          `${table}.${column}`,
        );
      }
      const { favorites } = await db
        .selectFrom('slide_library')
        .select('favorites')
        .executeTakeFirstOrThrow();
      assert.deepEqual(favorites, [ANN]);

      // A second run finds nothing left to do.
      for (const spec of EMAIL_COLUMNS) {
        assert.deepEqual(await countUnnormalized(db, spec), {
          unnormalized: 0,
          foldable: 0,
        });
      }
      assert.equal(await countUnnormalizedFavorites(db), 0);
      await runMigration(db);
    });

    it('leaves a row that would collide on a unique constraint as it is', async () => {
      const canonical = await insertUser(ANN);
      const legacy = await insertUser(LEGACY_ANN);
      // Two legacy spellings of one other address collide with each other.
      const first = await insertUser('Bob@Example.com');
      const second = await insertUser('BOB@example.com ');
      const carol = await insertUser(' Carol@Example.com');
      const spec = EMAIL_COLUMNS.find((c) => c.table === 'users');

      assert.deepEqual(await countUnnormalized(db, spec), {
        unnormalized: 4,
        foldable: 1,
      });
      await runMigration(db);

      const byId = Object.fromEntries(
        (await db.selectFrom('users').select(['id', 'email']).execute()).map(
          (r) => [r.id, r.email],
        ),
      );
      assert.equal(byId[canonical], ANN);
      assert.equal(byId[legacy], LEGACY_ANN, 'would collide with ann');
      assert.equal(byId[first], 'Bob@Example.com', 'collides with its twin');
      assert.equal(byId[second], 'BOB@example.com ');
      assert.equal(byId[carol], 'carol@example.com');
    });

    it('leaves a blank value in a NOT NULL column as it is', async () => {
      const deck = await insertDeck();
      await db
        .insertInto('presentation_versions')
        .values({
          presentation_id: deck,
          organization_id: orgId,
          created_by: '  ',
          revision: 1,
          presentation_data: JSON.stringify({}),
        })
        .execute();
      const spec = EMAIL_COLUMNS.find(
        (c) => c.table === 'presentation_versions',
      );

      assert.deepEqual(await countUnnormalized(db, spec), {
        unnormalized: 1,
        foldable: 0,
      });
      await runMigration(db);

      const { created_by: createdBy } = await db
        .selectFrom('presentation_versions')
        .select('created_by')
        .executeTakeFirstOrThrow();
      assert.equal(createdBy, '  ', 'NULL would break the NOT NULL constraint');
    });

    it('folds the favorites per element, dropping blanks and duplicates', async () => {
      const id = await insertLibraryItem('organization', [
        LEGACY_ANN,
        ANN,
        '  ',
        'Bob@Example.com',
      ]);
      await runMigration(db);
      const { favorites } = await db
        .selectFrom('slide_library')
        .select('favorites')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.deepEqual([...favorites].sort(), [ANN, 'bob@example.com']);
    });
  });

  it('getUserIdByEmail finds the user from a mixed-case address', async () => {
    const ann = await insertUser(ANN);
    const scope = testScope();
    assert.equal(await getUserIdByEmail(scope, db, ASKED_AS), ann);
    assert.equal(await getUserIdByEmail(scope, db, ANN), ann);
    assert.equal(await getUserIdByEmail(scope, db, '  '), null);
    assert.equal(await getUserIdByEmail(scope, db, 'nobody@example.com'), null);
  });

  describe('the slide library after the migration', () => {
    it('finds a legacy favorite from a mixed-case address', async () => {
      const id = await insertLibraryItem('organization');
      await runMigration(db);
      const { items } = await listOrganizationLibrary(testScope(), {
        userEmail: ASKED_AS,
      });
      assert.equal(items.find((it) => it.id === id)?.favorite, true);
    });

    it('stores a new favorite in the normalised spelling', async () => {
      const id = await insertLibraryItem('organization', []);
      await runMigration(db);
      const out = await updateOrganizationLibraryItem(
        testScope(null, { actorEmail: ASKED_AS }),
        id,
        { favorite: true },
      );
      assert.equal(out.ok, true);
      const { favorites } = await db
        .selectFrom('slide_library')
        .select('favorites')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.deepEqual(favorites, [ANN]);
    });

    it('finds a legacy personal item from a mixed-case owner', async () => {
      const id = await insertLibraryItem('personal');
      await runMigration(db);
      const { items } = await listPersonalLibrary(testScope(), ASKED_AS);
      assert.deepEqual(
        items.map((it) => it.id),
        [id],
      );
    });
  });
});
