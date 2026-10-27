/**
 * Migration 102 (B257 B5-rest, D359, D360) against real PostgreSQL.
 *
 * Which keys go is covered DB-lessly in
 * tests/strip-undeclared-content-keys-migration.test.js. What that cannot
 * cover is the walk over the stored columns:
 *
 *  - a deck, a version snapshot, a comment snapshot and a library item that
 *    carry the retired legacy keys (B2) come out without them, and nothing else changes;
 *  - a deck's collab binary is dropped when the deck changed, kept otherwise;
 *  - a clean deck is not written (its row stays byte for byte);
 *  - a published DB type of the deck's organization is held to its fields;
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
import { up as stripUndeclared } from '../../server/db/migrations/102_strip_undeclared_content_keys.js';
import { DECLARED, legacyDeck } from '../helpers/legacy-content-keys.js';

/**
 * Run the migration the way the runner does: one transaction.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<void>}
 */
const runMigration = (db) =>
  db.transaction().execute((trx) => stripUndeclared(trx));

pgDescribe('strip undeclared content keys migration (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let orgId;
  /** @type {Record<string, string>} */
  let ids;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations', 'slide_library', 'custom_slide_types');
    orgId = await seedDefaultOrganization(db);
    ids = {
      legacy: crypto.randomUUID(),
      clean: crypto.randomUUID(),
      custom: crypto.randomUUID(),
      snapshot: crypto.randomUUID(),
      comment: crypto.randomUUID(),
      library: crypto.randomUUID(),
    };

    const deck = legacyDeck();
    const cleanSlide = {
      id: 'clean-1',
      type: 'title-slide',
      content: { title: 'Schoon' },
    };
    const decks = [
      [ids.legacy, deck.slides, deck.i18n],
      [ids.clean, [cleanSlide], { versions: { nl: { slides: [cleanSlide] } } }],
      [
        ids.custom,
        [
          {
            id: 'custom-1',
            type: 'custom-hero',
            content: { headline: 'Hoi', removedField: 'weg' },
          },
        ],
        {},
      ],
    ];
    for (const [id, slides, i18n] of decks) {
      await db
        .insertInto('presentations')
        .values({
          id,
          organization_id: orgId,
          title: 'Deck',
          slides: JSON.stringify(slides),
          i18n: JSON.stringify(i18n),
        })
        .execute();
    }

    await db
      .insertInto('custom_slide_types')
      .values({
        id: crypto.randomUUID(),
        organization_id: orgId,
        slug: 'hero',
        label: 'Hero',
        fields: JSON.stringify([{ key: 'headline', type: 'string' }]),
        is_published: true,
      })
      .execute();

    for (const id of [ids.legacy, ids.clean]) {
      await db
        .insertInto('presentation_ydocs')
        .values({
          presentation_id: id,
          organization_id: orgId,
          state: Buffer.from([1, 2, 3]),
        })
        .execute();
    }

    await db
      .insertInto('presentation_versions')
      .values({
        id: ids.snapshot,
        presentation_id: ids.legacy,
        organization_id: orgId,
        title: 'Snapshot',
        presentation_data: JSON.stringify({ title: 'Deck', ...legacyDeck() }),
      })
      .execute();

    await db
      .insertInto('presentation_comments')
      .values({
        id: ids.comment,
        presentation_id: ids.legacy,
        organization_id: orgId,
        author_email: 'owner@example.com',
        body: 'oud',
        slide_snapshot: JSON.stringify(legacyDeck().slides[0]),
      })
      .execute();

    await db
      .insertInto('slide_library')
      .values({
        id: ids.library,
        organization_id: orgId,
        shelf: 'organization',
        name: 'Slot',
        slide_type: 'payoff-slide',
        content: JSON.stringify({ tagline: 'Bedankt' }),
        i18n: JSON.stringify({
          versions: { 'en-GB': { content: { tagline: 'Thanks' } } },
        }),
      })
      .execute();
  });

  const readDeck = (id) =>
    db
      .selectFrom('presentations')
      .select(['slides', 'i18n', 'modified_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const ydocIds = async () =>
    (
      await db
        .selectFrom('presentation_ydocs')
        .select('presentation_id')
        .execute()
    ).map((row) => row.presentation_id);

  /** Every slide list of a deck-shaped object. */
  const lists = (deck) => [
    deck.slides,
    ...Object.values(deck.i18n?.versions || {}).map((v) => v.slides),
  ];

  it('strips the legacy keys from a deck, in every version', async () => {
    await runMigration(db);
    const row = await readDeck(ids.legacy);
    for (const slides of lists(row)) {
      for (const slide of slides) {
        assert.deepStrictEqual(slide.content, DECLARED[slide.type]);
      }
    }
  });

  it('strips a version snapshot, a comment snapshot and a library item', async () => {
    await runMigration(db);
    const snapshot = await db
      .selectFrom('presentation_versions')
      .select('presentation_data')
      .where('id', '=', ids.snapshot)
      .executeTakeFirstOrThrow();
    assert.strictEqual(snapshot.presentation_data.title, 'Deck');
    for (const slides of lists(snapshot.presentation_data)) {
      for (const slide of slides) {
        assert.deepStrictEqual(slide.content, DECLARED[slide.type]);
      }
    }

    const comment = await db
      .selectFrom('presentation_comments')
      .select(['slide_snapshot', 'body'])
      .where('id', '=', ids.comment)
      .executeTakeFirstOrThrow();
    assert.deepStrictEqual(
      comment.slide_snapshot.content,
      DECLARED['title-slide'],
    );
    assert.strictEqual(comment.body, 'oud');

    const item = await db
      .selectFrom('slide_library')
      .select(['content', 'i18n'])
      .where('id', '=', ids.library)
      .executeTakeFirstOrThrow();
    assert.deepStrictEqual(item.content, {});
    assert.deepStrictEqual(item.i18n.versions['en-GB'].content, {});
  });

  it("holds a DB type to its organization's fields", async () => {
    await runMigration(db);
    const row = await readDeck(ids.custom);
    assert.deepStrictEqual(row.slides[0].content, { headline: 'Hoi' });
  });

  it('drops the collab binary of a changed deck only', async () => {
    await runMigration(db);
    assert.deepStrictEqual(await ydocIds(), [ids.clean]);
  });

  it('leaves a clean deck alone and is idempotent', async () => {
    const before = await readDeck(ids.clean);
    await runMigration(db);
    assert.deepStrictEqual(await readDeck(ids.clean), before);

    const once = await readDeck(ids.legacy);
    await runMigration(db);
    assert.deepStrictEqual(await readDeck(ids.legacy), once);
  });
});
