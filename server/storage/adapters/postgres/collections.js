/**
 * PostgreSQL slide collections storage module.
 *
 * A collection is a named, ordered, scoped set of slide-library items. It
 * references existing slide_library rows via the slide_collection_items join
 * table (ordered by `position`); it never copies slide content.
 */

import { getDb, getOrgId, now } from './helpers.js';
import { mapSlideCollectionRow } from '../../mappers.js';

/**
 * Load ordered member slide ids for a set of collections.
 * @param {import('kysely').Kysely} db
 * @param {string[]} collectionIds
 * @returns {Promise<Map<string, string[]>>} collectionId -> ordered slideIds
 */
async function loadMembership(db, collectionIds) {
  const result = new Map();
  if (!collectionIds || collectionIds.length === 0) return result;

  const rows = await db
    .selectFrom('slide_collection_items')
    .select(['collection_id', 'slide_library_id', 'position'])
    .where('collection_id', 'in', collectionIds)
    .orderBy('position', 'asc')
    .execute();

  for (const row of rows) {
    if (!result.has(row.collection_id)) result.set(row.collection_id, []);
    result.get(row.collection_id).push(row.slide_library_id);
  }
  return result;
}

/**
 * Keep only ids that reference existing slide_library rows in this org,
 * de-duplicated and preserving the requested order. Guards the join-table FK.
 * @param {import('kysely').Kysely} db
 * @param {string} orgId
 * @param {string[]} slideIds
 * @returns {Promise<string[]>}
 */
async function filterExistingSlideIds(db, orgId, slideIds) {
  const cleaned = [];
  const seen = new Set();
  for (const raw of Array.isArray(slideIds) ? slideIds : []) {
    const id = String(raw || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      cleaned.push(id);
    }
  }
  if (cleaned.length === 0) return [];

  const rows = await db
    .selectFrom('slide_library')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('id', 'in', cleaned)
    .execute();
  const existing = new Set(rows.map((r) => String(r.id)));
  return cleaned.filter((id) => existing.has(id));
}

/**
 * Replace a collection's ordered membership.
 * @param {import('kysely').Kysely} db
 * @param {string} orgId
 * @param {string} collectionId
 * @param {string[]} slideIds
 * @returns {Promise<string[]>} the stored (validated) slide ids in order
 */
async function replaceMembership(db, orgId, collectionId, slideIds) {
  const valid = await filterExistingSlideIds(db, orgId, slideIds);

  await db
    .deleteFrom('slide_collection_items')
    .where('collection_id', '=', collectionId)
    .execute();

  if (valid.length > 0) {
    await db
      .insertInto('slide_collection_items')
      .values(
        valid.map((slideId, index) => ({
          collection_id: collectionId,
          slide_library_id: slideId,
          position: index,
          created_at: now(),
        }))
      )
      .execute();
  }
  return valid;
}

/**
 * Slide Collections mixin - adds collection methods to the adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withCollections(Base) {
  return class extends Base {
    /**
     * List slide collections.
     * @param {object} ctx - Storage context
     * @param {object} [opts]
     * @param {string} [opts.scope] - 'personal' or 'team'
     * @param {string} [opts.ownerEmail] - filter to an owner (personal)
     */
    async listSlideCollections(ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      let query = db
        .selectFrom('slide_collections')
        .selectAll()
        .where('organization_id', '=', orgId);

      if (opts?.scope) query = query.where('scope', '=', opts.scope);
      if (opts?.ownerEmail) query = query.where('owner_email', '=', opts.ownerEmail);

      query = query.orderBy('created_at', 'desc');
      const rows = await query.execute();

      const membership = await loadMembership(db, rows.map((r) => r.id));
      return rows.map((row) => mapSlideCollectionRow(row, membership.get(row.id) || []));
    }

    async getSlideCollection(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('slide_collections')
        .selectAll()
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!row) return null;
      const membership = await loadMembership(db, [row.id]);
      return mapSlideCollectionRow(row, membership.get(row.id) || []);
    }

    async createSlideCollection(data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .insertInto('slide_collections')
        .values({
          organization_id: orgId,
          owner_email: data.ownerEmail || ctx?.actorEmail || null,
          scope: data.scope || 'personal',
          name: data.name,
          description: data.description || null,
          created_by: ctx?.actorEmail || null,
          updated_by: ctx?.actorEmail || null,
        })
        .returningAll()
        .executeTakeFirst();

      const slideIds = await replaceMembership(db, orgId, row.id, data.slideIds || []);
      return mapSlideCollectionRow(row, slideIds);
    }

    async updateSlideCollection(id, data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const updateData = {
        updated_by: ctx?.actorEmail,
        updated_at: now(),
      };
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;

      const row = await db
        .updateTable('slide_collections')
        .set(updateData)
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .returningAll()
        .executeTakeFirst();

      if (!row) return null;

      let slideIds;
      if (data.slideIds !== undefined) {
        slideIds = await replaceMembership(db, orgId, id, data.slideIds || []);
      } else {
        const membership = await loadMembership(db, [id]);
        slideIds = membership.get(id) || [];
      }
      return mapSlideCollectionRow(row, slideIds);
    }

    async deleteSlideCollection(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const result = await db
        .deleteFrom('slide_collections')
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      return result.numDeletedRows > 0;
    }
  };
}
