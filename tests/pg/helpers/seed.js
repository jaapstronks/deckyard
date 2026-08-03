/**
 * Row seeders for the real-PostgreSQL facade tests.
 *
 * The file adapter these tests replace stored everything as loose JSON on disk,
 * so a presentation id was any string and no foreign key was ever checked.
 * PostgreSQL is stricter: a tag needs an `organizations` row to belong to, a
 * `presentation_tags` link needs a real `presentations.id` (a uuid, not the
 * `'p1'` literals the file suite used), a collection item needs a
 * `slide_library` row. These helpers seed exactly the parents a facade call
 * needs, and nothing more.
 *
 * They insert with `ON CONFLICT DO NOTHING` where a fixed id is reused, so a
 * beforeEach that reseeds after a CASCADE truncate stays idempotent.
 */

import crypto from 'node:crypto';

import { getDefaultOrganizationId } from '../../../server/config/database.js';

/**
 * Ensure the instance's default organization exists (the one `testScope`
 * acts in). Returns its id.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<string>}
 */
export async function seedDefaultOrganization(db) {
  const id = getDefaultOrganizationId();
  await db
    .insertInto('organizations')
    .values({ id, name: 'Test Org', slug: 'test-org' })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  return id;
}

/**
 * Insert a presentation and return its (generated, uuid) id. The file suite
 * addressed presentations by bare strings like `'p1'`; against real PostgreSQL
 * the id is a uuid foreign-keyed from `presentation_tags`, so tests seed real
 * rows and thread the returned ids through.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {object} [opts]
 * @param {string} [opts.organizationId] - Owning org (default org if omitted).
 * @param {string} [opts.title]
 * @returns {Promise<string>}
 */
export async function seedPresentation(db, { organizationId, title = 'Deck' } = {}) {
  const orgId = organizationId || getDefaultOrganizationId();
  // presentations.id is a NOT NULL uuid with no default — the app supplies it.
  const id = crypto.randomUUID();
  const row = await db
    .insertInto('presentations')
    .values({ id, organization_id: orgId, title })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Insert a slide-library item and return its id. Only the NOT NULL columns are
 * set (scope, name, slide_type, content); the rest take their defaults.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {object} opts
 * @param {string} [opts.organizationId]
 * @param {string} [opts.scope='team'] - 'personal' | 'team'.
 * @param {string} [opts.ownerEmail] - Required by the personal scope.
 * @param {string} [opts.name='Slide']
 * @param {string} [opts.slideType='text']
 * @param {object} [opts.content]
 * @returns {Promise<string>}
 */
export async function seedSlideLibraryItem(
  db,
  { organizationId, scope = 'team', ownerEmail = null, name = 'Slide', slideType = 'text', content = {} } = {}
) {
  const orgId = organizationId || getDefaultOrganizationId();
  const row = await db
    .insertInto('slide_library')
    .values({
      organization_id: orgId,
      scope,
      owner_email: ownerEmail,
      name,
      slide_type: slideType,
      content: JSON.stringify(content),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Insert an image-library item and return its (generated, uuid) id.
 * `image_library_favorites.image_id` is a NOT NULL FK to `image_library(id)`,
 * so favoriting needs a real image row; only the NOT NULL `url` is set.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {object} [opts]
 * @param {string} [opts.organizationId]
 * @param {string} [opts.url='https://example.com/img.png']
 * @returns {Promise<string>}
 */
export async function seedImageLibraryItem(
  db,
  { organizationId, url = 'https://example.com/img.png' } = {}
) {
  const orgId = organizationId || getDefaultOrganizationId();
  const row = await db
    .insertInto('image_library')
    .values({ organization_id: orgId, url })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}
