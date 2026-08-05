/**
 * PostgreSQL slide library storage module.
 */

import { getDb, getOrgId, jsonb, now, sql, applyPagination } from './helpers.js';
import { mapSlideLibraryRow } from '../../mappers.js';
import { resolveIdentityByEmail } from '../../identity-resolver.js';

/**
 * Slides mixin - adds slide library methods to adapter.
 * @param {import('../types.js').AdapterBase} Base
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

      // Dual-key (T10 PR F2): resolve the id once and stamp it beside both the
      // created_by and updated_by e-mail (the same actor at create), so the
      // team-library authz guard can match on the stable id.
      const actorEmail = ctx?.actorEmail || null;
      const actorResolution = actorEmail ? await resolveIdentityByEmail(actorEmail) : null;
      const actorUserId = actorResolution?.userId ?? null;

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
          i18n: jsonb(data.i18n || {}),
          favorites: sql`${data.favorites || []}::text[]`,
          created_by: actorEmail,
          created_by_user_id: actorUserId,
          updated_by: actorEmail,
          updated_by_user_id: actorUserId,
        })
        .returningAll()
        .executeTakeFirst();

      return mapSlideLibraryRow(row);
    }

    async updateSlideLibraryItem(id, data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      // Build update object, only including fields that are defined.
      // Dual-key (T10 PR F2): stamp updated_by_user_id from the same
      // resolution only when there is an actor to stamp, so an actor-less
      // write (Kysely drops the undefined updated_by) never nulls the id half
      // while the e-mail half keeps the previous writer.
      const updateData = {
        updated_at: now(),
      };
      if (ctx?.actorEmail) {
        const actorResolution = await resolveIdentityByEmail(ctx.actorEmail);
        updateData.updated_by = ctx.actorEmail;
        updateData.updated_by_user_id = actorResolution?.userId ?? null;
      }
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.content !== undefined) updateData.content = jsonb(data.content);
      if (data.i18n !== undefined) updateData.i18n = jsonb(data.i18n);
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