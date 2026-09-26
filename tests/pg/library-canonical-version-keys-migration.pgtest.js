/**
 * Migration 084 (B482) against real PostgreSQL: which library rows it reads.
 *
 * The per-block rule is covered DB-lessly in
 * tests/library-canonical-version-keys-migration.test.js. What that cannot
 * cover is the SQL filter in front of it, so it is tested here:
 *
 *  - an item with an alias key, or an alias `dominant`, comes out canonical;
 *  - only rows with a key or `dominant` off the canonical set are selected; a
 *    canonical item, one without i18n and one whose `versions` is not an
 *    object are not read, and are left byte for byte alone;
 *  - an alias next to its canonical key is selected but left alone;
 *  - a second run changes nothing.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import {
  selectNonCanonicalLibraryRows,
  up as canonicalizeLibraryKeys,
} from '../../server/db/migrations/084_library_canonical_version_keys.js';

const v = (title) => ({ content: { title } });

/** Run the migration the way the runner does: one transaction. */
const runMigration = (db) =>
  db.transaction().execute((trx) => canonicalizeLibraryKeys(trx));

pgDescribe('library canonical version keys migration (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {Record<string, string>} */
  let ids;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    const orgId = await seedDefaultOrganization(db);

    const items = {
      alias: { dominant: 'nl', versions: { nl: v('Hallo'), en: v('Hello') } },
      aliasDominant: { dominant: 'en', versions: { 'en-GB': v('Hello') } },
      canonical: { dominant: 'nl', versions: { nl: v('Hallo') } },
      clash: { versions: { 'en-GB': v('A'), en: v('B') } },
      empty: {},
      scalarVersions: { versions: 'nl' },
    };
    ids = {};
    for (const [name, i18n] of Object.entries(items)) {
      ids[name] = crypto.randomUUID();
      await db
        .insertInto('slide_library')
        .values({
          id: ids[name],
          organization_id: orgId,
          shelf: 'personal',
          owner_email: 'alice@example.com',
          name,
          slide_type: 'content-slide',
          content: JSON.stringify({ title: name }),
          i18n: JSON.stringify(i18n),
        })
        .execute();
    }
  });

  /** Every item's i18n, keyed by id. */
  const readItems = async () =>
    Object.fromEntries(
      (
        await db.selectFrom('slide_library').select(['id', 'i18n']).execute()
      ).map((row) => [row.id, row.i18n]),
    );

  it('selects only the rows with a key or dominant off the canonical set', async () => {
    const selected = (await selectNonCanonicalLibraryRows(db))
      .map((row) => row.id)
      .sort();
    assert.deepStrictEqual(
      selected,
      [ids.alias, ids.aliasDominant, ids.clash].sort(),
    );
  });

  it('renames an alias key and normalizes an alias dominant', async () => {
    await runMigration(db);

    const items = await readItems();
    assert.deepStrictEqual(items[ids.alias], {
      dominant: 'nl',
      versions: { nl: v('Hallo'), 'en-GB': v('Hello') },
    });
    assert.deepStrictEqual(items[ids.aliasDominant], {
      dominant: 'en-GB',
      versions: { 'en-GB': v('Hello') },
    });
  });

  it('leaves canonical, empty, malformed and clashing rows alone', async () => {
    const before = await readItems();
    await runMigration(db);
    const after = await readItems();
    for (const name of ['canonical', 'empty', 'scalarVersions', 'clash']) {
      assert.deepStrictEqual(after[ids[name]], before[ids[name]], name);
    }
  });

  it('is idempotent: a second run changes nothing', async () => {
    await runMigration(db);
    const items = await readItems();
    await runMigration(db);
    assert.deepStrictEqual(await readItems(), items);
  });
});
