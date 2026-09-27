/**
 * Migration 083 (B481) against real PostgreSQL: which rows it reads.
 *
 * The per-block rule (rename an alias whose canonical key is free, leave the
 * rest for an operator) is covered DB-lessly in
 * tests/canonical-version-keys-migration.test.js. What that cannot cover is
 * the SQL filter in front of it: `up` must read only the rows whose
 * `i18n.versions` carries a key off the canonical set, so a store with
 * thousands of snapshots does not load them all to rewrite none. That is a
 * SQL-shaped claim, so it is tested here:
 *
 *  - a deck and a snapshot with an alias key come out renamed, the rest of the
 *    snapshot kept;
 *  - only rows with a key off the canonical set are selected; a canonical
 *    deck, a deck without versions and a deck whose `versions` is not an
 *    object are not read at all, and are left byte for byte alone;
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
  selectNonCanonical,
  up as canonicalizeVersionKeys,
} from '../../server/db/migrations/083_canonical_version_keys.js';

const v = (title) => ({ title, slides: [] });

/**
 * Run the migration the way the runner does: one transaction.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<void>}
 */
const runMigration = (db) =>
  db.transaction().execute((trx) => canonicalizeVersionKeys(trx));

pgDescribe('canonical version keys migration (real PostgreSQL)', () => {
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

    const decks = {
      alias: { dominant: 'nl', versions: { nl: v('Dek'), en: v('Deck') } },
      canonical: { dominant: 'nl', versions: { nl: v('Dek') } },
      clash: { versions: { 'en-GB': v('A'), en: v('B') } },
      noVersions: { dominant: 'nl' },
      scalarVersions: { versions: 'nl' },
    };
    ids = {};
    for (const [name, i18n] of Object.entries(decks)) {
      ids[name] = crypto.randomUUID();
      await db
        .insertInto('presentations')
        .values({
          id: ids[name],
          organization_id: orgId,
          title: name,
          slides: JSON.stringify([]),
          i18n: JSON.stringify(i18n),
        })
        .execute();
    }

    for (const [name, i18n] of [
      ['snapAlias', { versions: { en: v('Deck') } }],
      ['snapCanonical', { versions: { 'en-GB': v('Deck') } }],
    ]) {
      ids[name] = crypto.randomUUID();
      await db
        .insertInto('presentation_versions')
        .values({
          id: ids[name],
          presentation_id: ids.canonical,
          organization_id: orgId,
          title: 'Snapshot',
          presentation_data: JSON.stringify({ title: 'Dek', slides: [], i18n }),
        })
        .execute();
    }
  });

  /** Every deck's i18n, keyed by id. */
  const readDecks = async () =>
    Object.fromEntries(
      (
        await db.selectFrom('presentations').select(['id', 'i18n']).execute()
      ).map((row) => [row.id, row.i18n]),
    );

  /** Every snapshot's presentation_data, keyed by id. */
  const readSnapshots = async () =>
    Object.fromEntries(
      (
        await db
          .selectFrom('presentation_versions')
          .select(['id', 'presentation_data'])
          .execute()
      ).map((row) => [row.id, row.presentation_data]),
    );

  it('selects only the rows with a key off the canonical set', async () => {
    const selected = async (table) =>
      (await selectNonCanonical(db, table)).map((row) => row.id).sort();

    assert.deepStrictEqual(
      await selected('presentations'),
      [ids.alias, ids.clash].sort(),
    );
    assert.deepStrictEqual(await selected('presentation_versions'), [
      ids.snapAlias,
    ]);
  });

  it('renames an alias key on a deck and on a snapshot', async () => {
    await runMigration(db);

    const decks = await readDecks();
    assert.deepStrictEqual(decks[ids.alias], {
      dominant: 'nl',
      versions: { nl: v('Dek'), 'en-GB': v('Deck') },
    });

    const snapshot = (await readSnapshots())[ids.snapAlias];
    assert.strictEqual(snapshot.title, 'Dek', 'the rest of the snapshot kept');
    assert.deepStrictEqual(snapshot.i18n.versions, { 'en-GB': v('Deck') });
  });

  it('leaves canonical, version-less and malformed rows byte for byte alone', async () => {
    const decksBefore = await readDecks();
    const snapshotsBefore = await readSnapshots();

    await runMigration(db);

    const decksAfter = await readDecks();
    for (const name of ['canonical', 'noVersions', 'scalarVersions']) {
      assert.deepStrictEqual(decksAfter[ids[name]], decksBefore[ids[name]]);
    }
    assert.deepStrictEqual(
      (await readSnapshots())[ids.snapCanonical],
      snapshotsBefore[ids.snapCanonical],
    );
  });

  it('leaves an alias next to its canonical key for an operator', async () => {
    const before = (await readDecks())[ids.clash];
    await runMigration(db);
    assert.deepStrictEqual((await readDecks())[ids.clash], before);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await runMigration(db);
    const decks = await readDecks();
    const snapshots = await readSnapshots();

    await runMigration(db);

    assert.deepStrictEqual(await readDecks(), decks);
    assert.deepStrictEqual(await readSnapshots(), snapshots);
  });
});
