/**
 * PostgreSQL slide library storage module.
 */

import { getDb, getOrgId, jsonb, now, sql, applyPagination } from './helpers.js';
import { mapSlideLibraryRow } from '../../mappers.js';

/**
 * Slides mixin - adds slide library methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withSlides(Base) {
  return class extends Base {
    /**
     * List slide library items.
     * @param {object} ctx - Storage context
     * @param {object} [opts] - Options
     * @param {string} [opts.scope] - 'personal' or 'team'
     * @param {string} [opts.ownerEmail] - Filter by owner
     * @param {string} [opts.themeId] - Filter by theme
     * @param {number} [opts.limit] - Max items to return
     * @param {number} [opts.offset] - Items to skip
     */
    async listSlideLibrary(ctx, opts = {}) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      let query = db
        .selectFrom('slide_library')
        .selectAll()
        .where('organization_id', '=', orgId);

      // Don't filter out trashed items - client handles trash view filtering

      if (opts?.scope) {
        query = query.where('scope', '=', opts.scope);
      }
      if (opts?.ownerEmail) {
        query = query.where('owner_email', '=', opts.ownerEmail);
      }
      if (opts?.themeId) {
        query = query.where('theme_id', '=', opts.themeId);
      }

      query = query.orderBy('created_at', 'desc');
      query = applyPagination(query, opts);
      const rows = await query.execute();

      return rows.map(mapSlideLibraryRow);
    }

    async getSlideLibraryItem(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('slide_library')
        .selectAll()
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!row) return null;
      return mapSlideLibraryRow(row);
    }

    async createSlideLibraryItem(data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .insertInto('slide_library')
        .values({
          organization_id: orgId,
          owner_email: data.ownerEmail || ctx?.actorEmail || null,
          scope: data.scope || 'personal',
          name: data.name,
          description: data.description || null,
          slide_type: data.slideType,
          theme_id: data.themeId || null,
          content: jsonb(data.content || {}),
          favorites: sql`${data.favorites || []}::text[]`,
          created_by: ctx?.actorEmail || null,
          updated_by: ctx?.actorEmail || null,
        })
        .returningAll()
        .executeTakeFirst();

      return mapSlideLibraryRow(row);
    }

    async updateSlideLibraryItem(id, data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      // Build update object, only including fields that are defined
      const updateData = {
        updated_by: ctx?.actorEmail,
        updated_at: now(),
      };
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.content !== undefined) updateData.content = jsonb(data.content);
      if (data.favorites !== undefined) updateData.favorites = sql`${data.favorites}::text[]`;
      if (data.trashedAt !== undefined) updateData.trashed_at = data.trashedAt;
      if (data.trashedBy !== undefined) updateData.trashed_by = data.trashedBy;

      const row = await db
        .updateTable('slide_library')
        .set(updateData)
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .returningAll()
        .executeTakeFirst();

      if (!row) return null;
      return mapSlideLibraryRow(row);
    }

    async deleteSlideLibraryItem(id, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const result = await db
        .deleteFrom('slide_library')
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      return result.numDeletedRows > 0;
    }
  };
}