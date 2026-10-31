/**
 * Image library usage against real PostgreSQL, through the storage facade.
 *
 * `getImageLibraryUsage()` used to scan `dataDir()/presentations/*.json`, a
 * directory nothing writes to on a PostgreSQL install — so the "where is this
 * image used" panel was always empty. It now queries the `presentations` table
 * with `jsonb_path_exists` over `slides` and `i18n`, which is a query shape the
 * in-memory double does not model: it has to run against PostgreSQL itself.
 *
 * What this pins down:
 * - a deck that references the URL in its base slides is found;
 * - so is one that references it only in an `i18n` language version;
 * - the match is whole-value and content-scoped, not a substring or a
 *   whole-deck sweep;
 * - trashed decks and other organizations' decks stay out;
 * - a deck with a public edition carries its newest one, a revoked one none;
 * - results come back newest-modified first.
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
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { getImageLibraryUsage } from '../../server/storage/image-library-usage.js';

const storageScope = testScope();

const URL_IN_SLIDES = '/uploads/hero.png';
const URL_IN_I18N = '/uploads/translated.png';
const URL_OUTSIDE_CONTENT = '/uploads/background.png';
const URL_UNUSED = '/uploads/nobody-uses-me.png';

pgDescribe('image library usage (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let otherOrgId;
  let deckWithImage;
  let deckWithNestedImage;
  let deckWithI18nImage;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);

    otherOrgId = crypto.randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: otherOrgId, name: 'Other Org', slug: 'other-org' })
      .execute();

    // Oldest of the three, so ordering is observable.
    deckWithImage = await seedPresentation(db, {
      title: 'Deck with image',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      slides: [
        { id: 's1', type: 'text', content: { text: 'no image here' } },
        {
          id: 's2',
          type: 'image',
          content: { image: { url: URL_IN_SLIDES }, alt: 'Hero' },
        },
      ],
    });

    deckWithNestedImage = await seedPresentation(db, {
      title: 'Deck with a gallery',
      modifiedAt: '2026-02-01T00:00:00.000Z',
      slides: [
        {
          id: 's1',
          type: 'gallery',
          content: {
            items: [{ src: '/uploads/other.png' }, { src: URL_IN_SLIDES }],
          },
        },
      ],
    });

    // Newest, and its displayed title comes from the dominant language version.
    deckWithI18nImage = await seedPresentation(db, {
      title: 'Base title',
      modifiedAt: '2026-03-01T00:00:00.000Z',
      slides: [{ id: 's1', type: 'text', content: { text: 'nothing' } }],
      i18n: {
        dominant: 'nl',
        versions: {
          nl: {
            title: 'Nederlandse titel',
            slides: [
              {
                id: 's1',
                type: 'image',
                content: { image: { url: URL_IN_I18N } },
              },
            ],
          },
        },
      },
    });

    // A URL that sits on the slide but outside `content` is not a usage.
    await seedPresentation(db, {
      title: 'Deck with a background',
      slides: [
        {
          id: 's1',
          type: 'text',
          background: { url: URL_OUTSIDE_CONTENT },
          content: {},
        },
      ],
    });

    // Trashed decks are invisible in the deck list, so they are invisible here.
    await seedPresentation(db, {
      title: 'Trashed deck',
      trashedAt: '2026-04-01T00:00:00.000Z',
      slides: [
        { id: 's1', type: 'image', content: { image: { url: URL_IN_SLIDES } } },
      ],
    });

    // Another organization's deck must never leak into this one's usage.
    await seedPresentation(db, {
      organizationId: otherOrgId,
      title: 'Foreign deck',
      slides: [
        { id: 's1', type: 'image', content: { image: { url: URL_IN_SLIDES } } },
      ],
    });
  });

  after(async () => {
    await closeTestDb(db);
  });

  it('finds every deck whose slide content references the URL, newest first', async () => {
    const usage = await getImageLibraryUsage(storageScope, URL_IN_SLIDES);
    assert.deepStrictEqual(
      usage.map((u) => u.id),
      [deckWithNestedImage, deckWithImage],
      'nested-in-an-array counts, and the newer deck comes first',
    );
    assert.strictEqual(usage[1].title, 'Deck with image');
    assert.ok(usage[0].modified, 'each hit carries its modified timestamp');
  });

  it('finds a deck that references the URL only in a language version', async () => {
    const usage = await getImageLibraryUsage(storageScope, URL_IN_I18N);
    assert.deepStrictEqual(
      usage.map((u) => u.id),
      [deckWithI18nImage],
    );
    assert.strictEqual(
      usage[0].title,
      'Nederlandse titel',
      "the dominant version's title wins over the base title",
    );
  });

  it('ignores a URL that sits outside slide content', async () => {
    assert.deepStrictEqual(
      await getImageLibraryUsage(storageScope, URL_OUTSIDE_CONTENT),
      [],
    );
  });

  it('matches whole values, not substrings', async () => {
    // '/uploads/hero.png' is used; a prefix of it is not a usage of anything.
    assert.deepStrictEqual(
      await getImageLibraryUsage(storageScope, '/uploads/hero'),
      [],
    );
    assert.deepStrictEqual(
      await getImageLibraryUsage(storageScope, URL_UNUSED),
      [],
    );
  });

  it('returns nothing for a blank URL instead of matching everything', async () => {
    assert.deepStrictEqual(await getImageLibraryUsage(storageScope, ''), []);
    assert.deepStrictEqual(await getImageLibraryUsage(storageScope, '   '), []);
    assert.deepStrictEqual(await getImageLibraryUsage(storageScope, null), []);
  });

  it('keeps trashed decks and other organizations out of the result', async () => {
    const usage = await getImageLibraryUsage(storageScope, URL_IN_SLIDES);
    assert.strictEqual(
      usage.length,
      2,
      'the trashed and the foreign deck also carry the URL',
    );
    const titles = usage.map((u) => u.title);
    assert.ok(!titles.includes('Trashed deck'));
    assert.ok(!titles.includes('Foreign deck'));
  });

  it('carries the newest public edition of a deck that is published', async () => {
    const orgId = storageScope.organizationId;
    const edition = async (publicationId, version) => {
      const row = await db
        .insertInto('publication_editions')
        .values({
          publication_id: publicationId,
          organization_id: orgId,
          version,
          source_revision: 1,
          renderer_hash: 'r',
          manifest_hash: `m${version}`,
          manifest_bytes: Buffer.from('{}'),
          input_bytes: Buffer.from('{}'),
          idempotency_key: `k-${publicationId}-${version}`,
          request_hash: 'h',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    };
    const series = async (presentationId) =>
      (
        await db
          .insertInto('publications')
          .values({ organization_id: orgId, presentation_id: presentationId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

    const published = await series(deckWithImage);
    await edition(published, 1);
    const v2 = await edition(published, 2);
    const revoked = await series(deckWithNestedImage);
    const only = await edition(revoked, 1);
    await db
      .insertInto('publication_edition_revocations')
      .values({ edition_id: only, organization_id: orgId })
      .execute();

    const usage = await getImageLibraryUsage(storageScope, URL_IN_SLIDES);
    const hit = usage.find((u) => u.id === deckWithImage);
    assert.ok(v2);
    assert.strictEqual(hit.published.version, 2);
    assert.strictEqual(hit.published.path, `/p/${published}/2`);

    const unpublished = usage.find((u) => u.id === deckWithNestedImage);
    assert.strictEqual(
      unpublished.published,
      null,
      'a deck whose only edition is revoked is not published',
    );
  });
});
