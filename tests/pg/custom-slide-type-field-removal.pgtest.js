/**
 * Removing a field from a custom slide type that stored slides still carry
 * (B849), against real PostgreSQL.
 *
 * Every write refuses a content key the slide's type does not declare (D359),
 * so a field removed from a type would leave each slide carrying it
 * unsaveable. `updateCustomSlideType()` therefore counts where the removed key
 * is stored and refuses with `field_in_use` unless forced; forced, it strips
 * the key in the same transaction as the type update.
 *
 * What this pins down:
 * - the count reaches every surface migration 102 walks: base slides and
 *   language versions (trashed decks too), version snapshots, comment
 *   snapshots, library items and their language versions;
 * - a refusal changes nothing, the type included;
 * - forced, every surface loses the key and nothing else, a changed deck's
 *   collab binary goes and an untouched deck's stays;
 * - another organization's slides under the same key are never touched.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import {
  seedDefaultOrganization,
  seedPresentation,
  seedSlideLibraryItem,
} from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { updateCustomSlideType } from '../../server/storage/custom-slide-types.js';

const storageScope = testScope();
const KEY = 'custom-hero';
const TWO_FIELDS = [
  { key: 'headline', type: 'string', label: 'Headline' },
  { key: 'kicker', type: 'string', label: 'Kicker' },
];
const ONE_FIELD = { fields: [TWO_FIELDS[0]] };

/** A slide of the type carrying both fields. */
const carrying = (id, kicker = 'K') => ({
  id,
  type: KEY,
  content: { headline: 'H', kicker },
});

pgDescribe('custom slide type field removal (PostgreSQL)', () => {
  let db;
  let orgId;
  let otherOrg;
  let ids;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    orgId = await seedDefaultOrganization(db);
    otherOrg = crypto.randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: otherOrg, name: 'Other', slug: 'other' })
      .execute();

    ids = {};
    for (const org of [orgId, otherOrg]) {
      const row = await db
        .insertInto('custom_slide_types')
        .values({
          organization_id: org,
          slug: 'hero',
          label: 'Hero',
          fields: JSON.stringify(TWO_FIELDS),
          is_published: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (org === orgId) ids.type = row.id;
    }

    ids.deck = await seedPresentation(db, {
      slides: [carrying('s1'), { id: 's2', type: 'text', content: {} }],
      i18n: {
        dominant: 'nl',
        versions: {
          nl: { title: 'NL', slides: [carrying('s1')] },
          'en-GB': { title: 'EN', slides: [carrying('s1', 'EN')] },
        },
      },
    });
    ids.trashed = await seedPresentation(db, {
      slides: [carrying('t1')],
      trashedAt: new Date().toISOString(),
    });
    ids.clean = await seedPresentation(db, {
      slides: [{ id: 'c1', type: KEY, content: { headline: 'only' } }],
    });
    ids.otherDeck = await seedPresentation(db, {
      organizationId: otherOrg,
      slides: [carrying('o1')],
    });

    for (const id of [ids.deck, ids.clean]) {
      await db
        .insertInto('presentation_ydocs')
        .values({
          presentation_id: id,
          organization_id: orgId,
          state: Buffer.from([1, 2, 3]),
        })
        .execute();
    }

    ids.snapshot = crypto.randomUUID();
    await db
      .insertInto('presentation_versions')
      .values({
        id: ids.snapshot,
        presentation_id: ids.deck,
        organization_id: orgId,
        title: 'Snapshot',
        presentation_data: JSON.stringify({
          slides: [],
          i18n: { versions: { nl: { slides: [carrying('s1')] } } },
        }),
      })
      .execute();

    ids.comment = crypto.randomUUID();
    await db
      .insertInto('presentation_comments')
      .values({
        id: ids.comment,
        presentation_id: ids.deck,
        organization_id: orgId,
        author_email: 'owner@example.com',
        body: 'note',
        slide_snapshot: JSON.stringify(carrying('s1')),
      })
      .execute();

    ids.library = await seedSlideLibraryItem(db, {
      slideType: KEY,
      content: { headline: 'H' },
    });
    await db
      .updateTable('slide_library')
      .set({
        i18n: JSON.stringify({
          versions: { 'en-GB': { content: { headline: 'H', kicker: 'EN' } } },
        }),
      })
      .where('id', '=', ids.library)
      .execute();
    ids.otherLibrary = await seedSlideLibraryItem(db, {
      organizationId: otherOrg,
      slideType: KEY,
      content: { headline: 'H', kicker: 'K' },
    });
  });

  after(async () => {
    await closeTestDb(db);
  });

  /** Everything the update may touch, as stored. */
  async function snapshotAll() {
    const tables = [
      ['custom_slide_types', ['id', 'fields']],
      ['presentations', ['id', 'slides', 'i18n']],
      ['presentation_versions', ['id', 'presentation_data']],
      ['presentation_comments', ['id', 'slide_snapshot']],
      ['slide_library', ['id', 'content', 'i18n']],
      ['presentation_ydocs', ['presentation_id']],
    ];
    const out = {};
    for (const [table, columns] of tables) {
      out[table] = await db
        .selectFrom(table)
        .select(columns)
        .orderBy(columns[0])
        .execute();
    }
    return out;
  }

  const deckRow = (id) =>
    db
      .selectFrom('presentations')
      .select(['slides', 'i18n'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  it('refuses with the count across every surface, and changes nothing', async () => {
    const before = await snapshotAll();

    const res = await updateCustomSlideType(storageScope, ids.type, ONE_FIELD);

    assert.deepStrictEqual(res, {
      ok: false,
      reason: 'field_in_use',
      usage: {
        fields: ['kicker'],
        slides: 2,
        decks: 2,
        libraryItems: 1,
        versions: 1,
        comments: 1,
      },
    });
    assert.deepStrictEqual(await snapshotAll(), before);
  });

  it('forced, strips the key everywhere in the organization and nothing else', async () => {
    const res = await updateCustomSlideType(storageScope, ids.type, ONE_FIELD, {
      force: true,
    });
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.deepStrictEqual(
      res.customSlideType.fields.map((f) => f.key),
      ['headline'],
    );

    const deck = await deckRow(ids.deck);
    assert.deepStrictEqual(deck.slides[0].content, { headline: 'H' });
    assert.deepStrictEqual(deck.slides[1], {
      id: 's2',
      type: 'text',
      content: {},
    });
    for (const lang of ['nl', 'en-GB']) {
      assert.deepStrictEqual(deck.i18n.versions[lang].slides[0].content, {
        headline: 'H',
      });
    }
    assert.deepStrictEqual((await deckRow(ids.trashed)).slides[0].content, {
      headline: 'H',
    });

    const snapshot = await db
      .selectFrom('presentation_versions')
      .select('presentation_data')
      .where('id', '=', ids.snapshot)
      .executeTakeFirstOrThrow();
    assert.deepStrictEqual(
      snapshot.presentation_data.i18n.versions.nl.slides[0].content,
      { headline: 'H' },
    );

    const comment = await db
      .selectFrom('presentation_comments')
      .select('slide_snapshot')
      .where('id', '=', ids.comment)
      .executeTakeFirstOrThrow();
    assert.deepStrictEqual(comment.slide_snapshot.content, { headline: 'H' });

    const item = await db
      .selectFrom('slide_library')
      .select(['content', 'i18n'])
      .where('id', '=', ids.library)
      .executeTakeFirstOrThrow();
    assert.deepStrictEqual(item.content, { headline: 'H' });
    assert.deepStrictEqual(item.i18n.versions['en-GB'].content, {
      headline: 'H',
    });

    const ydocs = await db
      .selectFrom('presentation_ydocs')
      .select('presentation_id')
      .execute();
    assert.deepStrictEqual(
      ydocs.map((r) => r.presentation_id),
      [ids.clean],
      "the changed deck's collab binary is dropped, the untouched one stays",
    );

    // Another organization keeps its slides and its type.
    assert.deepStrictEqual((await deckRow(ids.otherDeck)).slides[0].content, {
      headline: 'H',
      kicker: 'K',
    });
    const otherItem = await db
      .selectFrom('slide_library')
      .select('content')
      .where('id', '=', ids.otherLibrary)
      .executeTakeFirstOrThrow();
    assert.deepStrictEqual(otherItem.content, { headline: 'H', kicker: 'K' });
    const otherType = await db
      .selectFrom('custom_slide_types')
      .select('fields')
      .where('organization_id', '=', otherOrg)
      .executeTakeFirstOrThrow();
    assert.strictEqual(otherType.fields.length, 2);
  });

  it('a second forced run finds nothing left to strip', async () => {
    await updateCustomSlideType(storageScope, ids.type, ONE_FIELD, {
      force: true,
    });
    const between = await snapshotAll();

    const res = await updateCustomSlideType(storageScope, ids.type, {
      ...ONE_FIELD,
    });

    assert.strictEqual(res.ok, true, JSON.stringify(res));
    const after = await snapshotAll();
    assert.deepStrictEqual(after.presentations, between.presentations);
    assert.deepStrictEqual(after.slide_library, between.slide_library);
  });
});
