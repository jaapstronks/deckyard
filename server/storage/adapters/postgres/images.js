/**
 * PostgreSQL image library storage module.
 */

import { getDb, getOrgId, jsonb, now, sql, applyPagination } from './helpers.js';
import { mapImageRow } from '../../mappers.js';

/**
 * Images mixin - adds image library methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withImages(Base) {
  return class extends Base {
    /**
     * List images in the library.
     * @param {object} ctx - Storage context
     * @param {object} [opts] - Options
     * @param {number} [opts.limit] - Max items to return
     * @param {number} [opts.offset] - Items to skip
     */
    async listImages(ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      let query = db
        .selectFrom('image_library')
        .selectAll()
        .where('organization_id', '=', orgId)
        .orderBy('created_at', 'desc');

      query = applyPagination(query, opts);
      const rows = await query.execute();

      return rows.map(mapImageRow);
    }

    async getImage(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('image_library')
        .selectAll()
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!row) return null;
      return mapImageRow(row);
    }

    async createImage(data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .insertInto('image_library')
        .values({
          organization_id: orgId,
          url: data.url,
          title: data.title || '',
          description: data.description || '',
          photographer: data.photographer || '',
          tags: sql`${data.tags || []}::text[]`,
          alts: jsonb(data.alts || { nl: '', 'en-GB': '' }),
          sources: sql`${data.sources || []}::text[]`,
          uploaded_by: data.uploadedBy || null,
        })
        .returningAll()
        .executeTakeFirst();

      return mapImageRow(row);
    }

    async updateImage(id, data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .updateTable('image_library')
        .set({
          url: data.url,
          title: data.title,
          description: data.description,
          photographer: data.photographer,
          tags: data.tags ? sql`${data.tags}::text[]` : undefined,
          alts: data.alts ? jsonb(data.alts) : undefined,
          sources: data.sources ? sql`${data.sources}::text[]` : undefined,
          updated_at: now(),
        })
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .returningAll()
        .executeTakeFirst();

      if (!row) return null;
      return mapImageRow(row);
    }

    async deleteImage(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const result = await db
        .deleteFrom('image_library')
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      return result.numDeletedRows > 0;
    }
  };
}