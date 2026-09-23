/**
 * Deleting a custom slide type counts its usage first (B414), against real
 * PostgreSQL.
 *
 * Nothing in the schema points at `custom_slide_types`, so a bare delete left
 * slides carrying `custom-<slug>` to fall back, silently, on the unknown-type
 * render. `deleteCustomSlideType()` now counts the key and refuses with
 * `in_use` and that count unless the caller forces it. The count is a set of
 * `jsonb_path` queries the in-memory double does not model, so it runs here.
 *
 * What this pins down:
 * - a type nothing uses is deleted as before;
 * - a used type refuses with the count, and stays;
 * - the count reaches every place the key lives: base slides, each language
 *   version's slides (an object keyed by locale), trashed decks, library items
 *   and version snapshots — and nothing in another organization;
 * - a slide present in several language versions (same id) counts once;
 * - `force` deletes a used type.
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
  uninstallFacadeStorage,
} from './helpers/harness.js';
import {
  seedDefaultOrganization,
  seedPresentation,
  seedSlideLibraryItem,
} from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { deleteCustomSlideType } from '../../server/storage/custom-slide-types.js';

const storageScope = testScope();
const KEY = 'custom-hero';

/**
 * @param {import('kysely').Kysely<any>} db
 * @param {string} orgId
 * @param {string} slug
 * @returns {Promise<string>} The type's id.
 */
async function seedCustomType(db, orgId, slug) {
  const row = await db
    .insertInto('custom_slide_types')
    .values({ organization_id: orgId, slug, label: slug })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * @param {import('kysely').Kysely<any>} db
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function typeExists(db, id) {
  const row = await db
    .selectFrom('custom_slide_types')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  return Boolean(row);
}

pgDescribe('deleteCustomSlideType usage count (PostgreSQL)', () => {
  let db;
  let orgId;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    orgId = await seedDefaultOrganization(db);
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('deletes a type nothing uses', async () => {
    const typeId = await seedCustomType(db, orgId, 'hero');
    // A deck with other slides, and a library item of another type.
    await seedPresentation(db, { slides: [{ id: 's1', type: 'text' }] });
    await seedSlideLibraryItem(db, { slideType: 'custom-other' });

    const res = await deleteCustomSlideType(storageScope, typeId);

    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(await typeExists(db, typeId), false);
  });

  it('refuses a used type with the count, across every place the key lives', async () => {
    const typeId = await seedCustomType(db, orgId, 'hero');
    const deckA = await seedPresentation(db, {
      slides: [
        { id: 's1', type: KEY },
        { id: 's2', type: 'text' },
        { id: 's3', type: KEY },
      ],
      // Language versions are an object keyed by locale, not an array.
      i18n: {
        dominant: 'en',
        versions: {
          nl: { title: 'NL', slides: [{ id: 's1', type: KEY }] },
          de: { title: 'DE', slides: [{ id: 's9', type: 'text' }] },
        },
      },
    });
    // A deck that uses the key only in a language version, in the trash.
    await seedPresentation(db, {
      slides: [],
      i18n: { versions: { fr: { slides: [{ id: 'f1', type: KEY }] } } },
      trashedAt: new Date().toISOString(),
    });
    // A deck that does not use it at all.
    await seedPresentation(db, { slides: [{ id: 'x', type: 'text' }] });
    await seedSlideLibraryItem(db, { slideType: KEY });
    await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: deckA,
        organization_id: orgId,
        presentation_data: JSON.stringify({
          slides: [{ id: 's1', type: KEY }],
        }),
      })
      .execute();

    // The same key in another organization never counts.
    const otherOrg = crypto.randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: otherOrg, name: 'Other', slug: 'other' })
      .execute();
    await seedCustomType(db, otherOrg, 'hero');
    await seedPresentation(db, {
      organizationId: otherOrg,
      slides: [{ id: 'o1', type: KEY }],
    });
    await seedSlideLibraryItem(db, {
      organizationId: otherOrg,
      slideType: KEY,
    });

    const res = await deleteCustomSlideType(storageScope, typeId);

    assert.deepStrictEqual(res, {
      ok: false,
      reason: 'in_use',
      usage: { slides: 3, decks: 2, libraryItems: 1, versions: 1 },
    });
    assert.strictEqual(await typeExists(db, typeId), true);
  });

  it('counts a version snapshot even when no live slide uses the type', async () => {
    const typeId = await seedCustomType(db, orgId, 'hero');
    const deck = await seedPresentation(db, { slides: [] });
    await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: deck,
        organization_id: orgId,
        presentation_data: JSON.stringify({
          slides: [],
          i18n: { versions: { nl: { slides: [{ id: 'a', type: KEY }] } } },
        }),
      })
      .execute();

    const res = await deleteCustomSlideType(storageScope, typeId);

    assert.strictEqual(res.reason, 'in_use');
    assert.deepStrictEqual(res.usage, {
      slides: 0,
      decks: 0,
      libraryItems: 0,
      versions: 1,
    });
  });

  it('deletes a used type when forced', async () => {
    const typeId = await seedCustomType(db, orgId, 'hero');
    await seedPresentation(db, { slides: [{ id: 's1', type: KEY }] });

    const res = await deleteCustomSlideType(storageScope, typeId, {
      force: true,
    });

    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(await typeExists(db, typeId), false);
  });

  it("answers not_found for another organization's type", async () => {
    const otherOrg = crypto.randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: otherOrg, name: 'Other', slug: 'other' })
      .execute();
    const typeId = await seedCustomType(db, otherOrg, 'hero');

    const res = await deleteCustomSlideType(storageScope, typeId, {
      force: true,
    });

    assert.deepStrictEqual(res, { ok: false, reason: 'not_found' });
    assert.strictEqual(await typeExists(db, typeId), true);
  });
});
