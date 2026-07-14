/**
 * PostgreSQL published presentations storage module.
 */

import { getDb, getOrgId, now, applyPagination } from './helpers.js';
import { mapPublishedRow } from '../../mappers.js';

/**
 * Published mixin - adds published presentation methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withPublished(Base) {
  return class extends Base {
    /**
     * List all published presentations.
     * @param {object} ctx - Storage context
     * @param {object} [opts] - Options
     * @param {number} [opts.limit] - Max items to return
     * @param {number} [opts.offset] - Items to skip
     */
    async listPublished(ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      let query = db
        .selectFrom('published_presentations')
        .selectAll()
        .where('organization_id', '=', orgId)
        .orderBy('modified_at', 'desc');

      query = applyPagination(query, opts);
      const rows = await query.execute();

      return rows.map(mapPublishedRow);
    }

    async getPublished(publishId, ctx) {
      const db = getDb();

      const row = await db
        .selectFrom('published_presentations')
        .selectAll()
        .where('id', '=', publishId)
        .executeTakeFirst();

      if (!row) return null;
      return mapPublishedRow(row);
    }

    async upsertPublished(data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);
      const timestamp = now();

      const existing = await this.getPublished(data.id, ctx);

      if (existing) {
        const row = await db
          .updateTable('published_presentations')
          .set({
            title: data.title,
            slug: data.slug,
            og_image_url: data.ogImageUrl,
            modified_at: timestamp,
          })
          .where('id', '=', data.id)
          .returningAll()
          .executeTakeFirst();

        return mapPublishedRow(row);
      }

      const row = await db
        .insertInto('published_presentations')
        .values({
          id: data.id,
          organization_id: orgId,
          presentation_id: data.presentationId,
          title: data.title,
          slug: data.slug,
          og_image_url: data.ogImageUrl,
        })
        .returningAll()
        .executeTakeFirst();

      return mapPublishedRow(row);
    }

    async deletePublished(publishId, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const result = await db
        .deleteFrom('published_presentations')
        .where('id', '=', publishId)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      return result.numDeletedRows > 0;
    }
  };
}