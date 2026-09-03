/**
 * Migration 081 against real PostgreSQL: the backfill that finishes 030.
 *
 * The v12 -> v13 funnel step is what makes the conversion *correct* — it runs
 * on every read, on every backend — and it is covered DB-lessly in
 * tests/schema-version.test.js and tests/agenda-timeline-i18n-funnel.test.js.
 * What neither can cover is the claim this migration makes: that the columns
 * 030 skipped are actually rewritten, in the shapes a real store holds them in.
 * That is a SQL-shaped claim, so it is tested here:
 *
 *  - a deck whose *only* remaining `agenda-timeline-slide` sits in a
 *    non-dominant language version comes out converted, items folded;
 *  - a version snapshot is converted in both halves it stores a deck in
 *    (`presentation_data.slides` and `presentation_data.i18n`);
 *  - a comment's slide snapshot and a library row are converted too;
 *  - a deck that never carried the type is left byte for byte alone;
 *  - a second run changes nothing (the "second dry-run is zero" check).
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

import { sql } from 'kysely';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { up as backfillAgendaTimeline } from '../../server/db/migrations/081_backfill_agenda_timeline_i18n.js';

const RETIRED = 'agenda-timeline-slide';

/** A slide as 030 left it in the columns it skipped. */
const legacySlide = (id, label) => ({
  id,
  type: RETIRED,
  content: {
    title: label,
    items: [
      { time: '2020', title: 'Start', body: 'Het begin' },
      { label: '2024', title: 'Nu', text: 'Vandaag' },
      // A non-string value is read the way the funnel step reads it: an object
      // or array is not a spelling (the next one gets its turn), a number is
      // its text. 030's bare `->>` would have written `["x"]` as the date.
      { time: ['x'], label: 2016, title: 'Cijfer' },
    ],
  },
  notes: 'blijft staan',
});

/** What those items must become — migration 030's fold. */
const CONVERTED_ITEMS = [
  { date: '2020', title: 'Start', text: 'Het begin' },
  { date: '2024', title: 'Nu', text: 'Vandaag' },
  { date: '2016', title: 'Cijfer', text: '' },
];

/** The already-converted dominant slide, the half 030 did do. */
const timelineSlide = (id) => ({
  id,
  type: 'timeline-slide',
  content: { title: 'Tijdlijn', items: CONVERTED_ITEMS },
  notes: 'blijft staan',
});

/** The i18n block of a half-migrated deck: dominant done, versions stuck. */
const stuckI18n = (slideId) => ({
  dominant: 'nl',
  active: 'nl',
  versions: {
    nl: { title: 'Tijdlijn', slides: [legacySlide(slideId, 'Tijdlijn')] },
    'en-GB': { title: 'Timeline', slides: [legacySlide(slideId, 'Timeline')] },
  },
});

/**
 * Run the migration the way the runner does: one transaction, so the `pg_temp`
 * helper functions it creates are visible to every statement that follows.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<void>}
 */
const runBackfill = (db) =>
  db.transaction().execute((trx) => backfillAgendaTimeline(trx));

pgDescribe('agenda-timeline i18n backfill (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let orgId;
  let deckId;
  let cleanDeckId;
  let versionId;
  let commentId;
  let libraryId;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations', 'slide_library');
    orgId = await seedDefaultOrganization(db);

    deckId = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id: deckId,
        organization_id: orgId,
        title: 'Half gemigreerd deck',
        slides: JSON.stringify([timelineSlide('s1')]),
        i18n: JSON.stringify(stuckI18n('s1')),
      })
      .execute();

    cleanDeckId = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id: cleanDeckId,
        organization_id: orgId,
        title: 'Deck zonder het oude type',
        slides: JSON.stringify([timelineSlide('s1')]),
        i18n: JSON.stringify({
          dominant: 'nl',
          active: 'nl',
          versions: {
            nl: { title: 'Tijdlijn', slides: [timelineSlide('s1')] },
          },
        }),
      })
      .execute();

    versionId = crypto.randomUUID();
    await db
      .insertInto('presentation_versions')
      .values({
        id: versionId,
        presentation_id: deckId,
        organization_id: orgId,
        title: 'Snapshot',
        presentation_data: JSON.stringify({
          title: 'Snapshot',
          // A snapshot older than 030 still carries the type in both halves.
          slides: [legacySlide('s1', 'Tijdlijn')],
          i18n: stuckI18n('s1'),
        }),
      })
      .execute();

    commentId = crypto.randomUUID();
    await db
      .insertInto('presentation_comments')
      .values({
        id: commentId,
        presentation_id: deckId,
        organization_id: orgId,
        author_email: 'owner@example.com',
        body: 'wat vinden we hiervan',
        slide_snapshot: JSON.stringify(legacySlide('s1', 'Tijdlijn')),
      })
      .execute();

    libraryId = crypto.randomUUID();
    await db
      .insertInto('slide_library')
      .values({
        id: libraryId,
        organization_id: orgId,
        shelf: 'organization',
        name: 'Tijdlijn',
        slide_type: RETIRED,
        content: JSON.stringify(legacySlide('s1', 'Tijdlijn').content),
        i18n: JSON.stringify({
          versions: {
            'en-GB': { content: legacySlide('s1', 'Timeline').content },
          },
        }),
      })
      .execute();
  });

  /** Read one row back as parsed JSON. */
  const readDeck = (id) =>
    db
      .selectFrom('presentations')
      .select(['slides', 'i18n'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  it('converts the language versions 030 skipped', async () => {
    await runBackfill(db);

    const row = await readDeck(deckId);
    for (const lang of ['nl', 'en-GB']) {
      const slide = row.i18n.versions[lang].slides[0];
      assert.strictEqual(slide.type, 'timeline-slide', lang);
      assert.deepStrictEqual(slide.content.items, CONVERTED_ITEMS, lang);
      assert.strictEqual(
        slide.notes,
        'blijft staan',
        `${lang}: rest untouched`,
      );
    }
    assert.strictEqual(row.slides[0].type, 'timeline-slide');
  });

  it('converts a version snapshot in both halves it stores a deck in', async () => {
    await runBackfill(db);

    const { presentation_data: data } = await db
      .selectFrom('presentation_versions')
      .select('presentation_data')
      .where('id', '=', versionId)
      .executeTakeFirstOrThrow();

    assert.strictEqual(data.slides[0].type, 'timeline-slide');
    assert.deepStrictEqual(data.slides[0].content.items, CONVERTED_ITEMS);
    assert.strictEqual(
      data.i18n.versions['en-GB'].slides[0].type,
      'timeline-slide',
    );
    assert.deepStrictEqual(
      data.i18n.versions['en-GB'].slides[0].content.items,
      CONVERTED_ITEMS,
    );
  });

  it('converts a comment snapshot and a library row', async () => {
    await runBackfill(db);

    const comment = await db
      .selectFrom('presentation_comments')
      .select('slide_snapshot')
      .where('id', '=', commentId)
      .executeTakeFirstOrThrow();
    assert.strictEqual(comment.slide_snapshot.type, 'timeline-slide');
    assert.deepStrictEqual(
      comment.slide_snapshot.content.items,
      CONVERTED_ITEMS,
    );

    const library = await db
      .selectFrom('slide_library')
      .select(['slide_type', 'content', 'i18n'])
      .where('id', '=', libraryId)
      .executeTakeFirstOrThrow();
    assert.strictEqual(library.slide_type, 'timeline-slide');
    assert.deepStrictEqual(library.content.items, CONVERTED_ITEMS);
    assert.deepStrictEqual(
      library.i18n.versions['en-GB'].content.items,
      CONVERTED_ITEMS,
    );
  });

  it('leaves a deck that never carried the type alone', async () => {
    const before = await readDeck(cleanDeckId);
    await runBackfill(db);
    const after = await readDeck(cleanDeckId);

    assert.deepStrictEqual(after, before);
  });

  it('is idempotent: a second run finds nothing left to convert', async () => {
    await runBackfill(db);
    const first = await readDeck(deckId);

    await runBackfill(db);
    const second = await readDeck(deckId);

    assert.deepStrictEqual(second, first);

    const like = `%${RETIRED}%`;
    const { rows } = await sql`
      SELECT count(*)::int AS n
      FROM presentations
      WHERE slides::text LIKE ${like} OR i18n::text LIKE ${like}
    `.execute(db);
    assert.strictEqual(rows[0].n, 0, 'no row still names the type');
  });
});
