/**
 * Blanking a withdrawn OG preview URL in PostgreSQL (B806): the deck's
 * `published.ogImageUrl` and the entry's `og_image_url` go to '' without
 * bumping the deck's revision or either `modified_at`, and a write that
 * raced the read (another revision, another URL) is left alone.
 */

import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  openTestDb,
  closeTestDb,
  installFacadeStorage,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  getPresentation,
  clearPublishedOgImageUrl,
} from '../../server/storage/presentations/index.js';
import {
  clearPublishedEntryOgImage,
  upsertPublishedEntry,
} from '../../server/storage/published.js';

const URL_OLD =
  'https://cdn.example.com/uploads/2026/10/og-v2-abcd1234-0123456789abcdef0123-00000000-0000-4000-8000-000000000001.png';

pgDescribe('clearing a withdrawn published preview in PostgreSQL', () => {
  let db;
  let id;
  const scope = testScope();

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    id = await seedPresentation(db, { modifiedAt: '2026-10-01T00:00:00Z' });
    await db
      .updateTable('presentations')
      .set({
        published: JSON.stringify({
          id: 'abcd1234',
          slug: 'deck',
          ogImageUrl: URL_OLD,
          previewFingerprint: 'stale',
        }),
      })
      .where('id', '=', id)
      .execute();
    await upsertPublishedEntry(scope, {
      publishId: 'abcd1234',
      presentationId: id,
      title: 'Deck',
      ogImageUrl: URL_OLD,
    });
  });

  after(async () => {
    await closeTestDb(db);
  });

  it('leaves a deck alone that moved on since the read', async () => {
    const read = await getPresentation(scope, id);
    assert.equal(
      await clearPublishedOgImageUrl(
        scope,
        { ...read, revision: read.revision + 1 },
        URL_OLD,
      ),
      false,
    );
    assert.equal(
      await clearPublishedEntryOgImage(scope, 'abcd1234', 'https://other/'),
      false,
    );
    assert.equal(
      (await getPresentation(scope, id)).published.ogImageUrl,
      URL_OLD,
    );
  });

  it('blanks both URLs without re-dating or re-revisioning anything', async () => {
    const before = await getPresentation(scope, id);
    const entryBefore = await db
      .selectFrom('published_presentations')
      .selectAll()
      .where('id', '=', 'abcd1234')
      .executeTakeFirstOrThrow();

    assert.equal(await clearPublishedOgImageUrl(scope, before, URL_OLD), true);
    assert.equal(
      await clearPublishedEntryOgImage(scope, 'abcd1234', URL_OLD),
      true,
    );

    const after = await getPresentation(scope, id);
    assert.equal(after.published.ogImageUrl, '');
    assert.equal(after.published.previewFingerprint, 'stale');
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.modified, before.modified);

    const entryAfter = await db
      .selectFrom('published_presentations')
      .selectAll()
      .where('id', '=', 'abcd1234')
      .executeTakeFirstOrThrow();
    assert.equal(entryAfter.og_image_url, '');
    assert.equal(entryAfter.slug, entryBefore.slug);
    assert.equal(
      new Date(entryAfter.modified_at).getTime(),
      new Date(entryBefore.modified_at).getTime(),
    );
  });
});
