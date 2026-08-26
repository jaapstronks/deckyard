/**
 * The legacy-background migration against real PostgreSQL
 * (scripts/migrate-legacy-bg-image.js).
 *
 * The pure walk is covered DB-lessly in tests/legacy-bg-image-migration.test.js.
 * What that suite cannot cover is exactly the hole B175 came from: on a
 * Postgres install the script walked a directory of deck JSON, found nothing,
 * and reported a clean zero — while `presentations.i18n` alone held hundreds of
 * legacy pairs. That is a SQL-shaped claim, so it is tested here:
 *
 *  - a `--dry-run` counts the real number of affected slides and writes nothing;
 *  - a real run folds `presentations.slides`, `presentations.i18n` and
 *    `slide_library.content` — including a deck whose *only* legacy background
 *    sits in a non-active language version;
 *  - version snapshots stay untouched unless `--include-versions` asks for them;
 *  - a second run touches no rows.
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
import { migratePostgres } from '../../scripts/migrate-legacy-bg-image.js';

/** A slide carrying the legacy pair. */
const legacySlide = (id, bgImage) => ({
  id,
  type: 'title-slide',
  content: { title: id, bgImage, bgAlt: 'oude alt' },
});

/** Look up one result row by table name. */
const forTable = (results, table) => results.find((r) => r.table === table);

pgDescribe('legacy bg-image migration (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let orgId;
  /** Deck whose only legacy background sits in a language version. */
  let translatedDeckId;
  let plainDeckId;
  let versionId;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations', 'slide_library');
    orgId = await seedDefaultOrganization(db);

    plainDeckId = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id: plainDeckId,
        organization_id: orgId,
        title: 'Deck met legacy-slide',
        slides: JSON.stringify([
          { id: 's1', type: 'title-slide', content: { title: 'Schoon' } },
          legacySlide('s2', '/uploads/nl.jpg'),
        ]),
        i18n: JSON.stringify({}),
      })
      .execute();

    translatedDeckId = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id: translatedDeckId,
        organization_id: orgId,
        title: 'Deck met legacy alleen in een taalversie',
        slides: JSON.stringify([
          { id: 's1', type: 'title-slide', content: { title: 'Schoon' } },
        ]),
        i18n: JSON.stringify({
          dominant: 'nl',
          versions: {
            'en-GB': { slides: [legacySlide('s1', '/uploads/en.jpg')] },
          },
        }),
      })
      .execute();

    const version = await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: plainDeckId,
        organization_id: orgId,
        title: 'Snapshot',
        presentation_data: JSON.stringify({
          id: plainDeckId,
          slides: [legacySlide('s2', '/uploads/nl.jpg')],
        }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    versionId = version.id;

    await db
      .insertInto('slide_library')
      .values({
        organization_id: orgId,
        shelf: 'organization',
        name: 'Intro',
        slide_type: 'title-slide',
        content: JSON.stringify({
          title: 'Intro',
          bgImage: '/uploads/lib.jpg',
        }),
      })
      .execute();
  });

  const readDeck = async (id) =>
    db
      .selectFrom('presentations')
      .select(['slides', 'i18n'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  it('--dry-run counts the real number of slides and writes nothing', async () => {
    const results = await migratePostgres(db, { dryRun: true });

    const presentations = forTable(results, 'presentations');
    assert.equal(presentations.present, true);
    assert.equal(presentations.rowsScanned, 2);
    assert.equal(presentations.rowsModified, 2);
    assert.equal(
      presentations.hits,
      2,
      'one in slides, one in a language version',
    );
    assert.equal(forTable(results, 'slide_library').hits, 1);
    assert.equal(
      forTable(results, 'presentation_versions'),
      undefined,
      'history is out of scope without --include-versions',
    );

    const deck = await readDeck(plainDeckId);
    const slides =
      typeof deck.slides === 'string' ? JSON.parse(deck.slides) : deck.slides;
    assert.equal(slides[1].content.bgImage, '/uploads/nl.jpg');
  });

  it('folds every in-scope surface, language versions included', async () => {
    await migratePostgres(db);

    const plain = await readDeck(plainDeckId);
    const slides =
      typeof plain.slides === 'string'
        ? JSON.parse(plain.slides)
        : plain.slides;
    assert.deepEqual(slides[1].content, {
      title: 's2',
      slideBgImage: '/uploads/nl.jpg',
      slideBgText: 'light',
      slideBgOverlay: 'gradient-bottom',
    });

    const translated = await readDeck(translatedDeckId);
    const i18n =
      typeof translated.i18n === 'string'
        ? JSON.parse(translated.i18n)
        : translated.i18n;
    const content = i18n.versions['en-GB'].slides[0].content;
    assert.equal(content.slideBgImage, '/uploads/en.jpg');
    assert.ok(!('bgImage' in content), 'the legacy key is gone');
    assert.ok(!('bgAlt' in content));

    const item = await db
      .selectFrom('slide_library')
      .select('content')
      .executeTakeFirstOrThrow();
    const libContent =
      typeof item.content === 'string'
        ? JSON.parse(item.content)
        : item.content;
    assert.equal(libContent.slideBgImage, '/uploads/lib.jpg');
  });

  it('leaves version snapshots alone unless asked', async () => {
    await migratePostgres(db);

    const readSnapshot = async () => {
      const row = await db
        .selectFrom('presentation_versions')
        .select('presentation_data')
        .where('id', '=', versionId)
        .executeTakeFirstOrThrow();
      return typeof row.presentation_data === 'string'
        ? JSON.parse(row.presentation_data)
        : row.presentation_data;
    };

    assert.equal(
      (await readSnapshot()).slides[0].content.bgImage,
      '/uploads/nl.jpg',
      'the fold is lossy, so history is kept as it was',
    );

    const results = await migratePostgres(db, { includeVersions: true });
    assert.equal(forTable(results, 'presentation_versions').hits, 1);
    assert.equal(
      (await readSnapshot()).slides[0].content.slideBgImage,
      '/uploads/nl.jpg',
    );
  });

  it('a second run touches no rows', async () => {
    await migratePostgres(db, { includeVersions: true });
    const again = await migratePostgres(db, { includeVersions: true });
    for (const result of again) {
      assert.equal(
        result.rowsModified,
        0,
        `${result.table} was rewritten again`,
      );
      assert.equal(result.hits, 0);
    }
  });
});
