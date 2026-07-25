/**
 * PostgreSQL settings storage module.
 */

import { getDb, getOrgId, jsonb, now, sql } from './helpers.js';
import { getUserByEmailGlobal } from '../../identity.js';

/**
 * Settings mixin - adds app and user settings methods to adapter.
 * @param {typeof import('../interface.js').StorageAdapter} Base
 */
export function withSettings(Base) {
  return class extends Base {
    async getAppSettings(ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('app_settings')
        .selectAll()
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!row) {
        return {
          supportedSlideLangs: ['nl', 'en-GB'],
          webhooks: {},
        };
      }

      return {
        supportedSlideLangs: row.supported_slide_langs || ['nl', 'en-GB'],
        webhooks: row.webhooks || {},
      };
    }

    async setAppSettings(data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const existing = await db
        .selectFrom('app_settings')
        .select('organization_id')
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (existing) {
        await db
          .updateTable('app_settings')
          .set({
            supported_slide_langs: data.supportedSlideLangs
              ? sql`${data.supportedSlideLangs}::text[]`
              : undefined,
            webhooks: data.webhooks ? jsonb(data.webhooks) : undefined,
            updated_at: now(),
          })
          .where('organization_id', '=', orgId)
          .execute();
      } else {
        await db
          .insertInto('app_settings')
          .values({
            organization_id: orgId,
            supported_slide_langs: sql`${data.supportedSlideLangs || ['nl', 'en-GB']}::text[]`,
            webhooks: jsonb(data.webhooks || {}),
          })
          .execute();
      }

      return this.getAppSettings(ctx);
    }

    // Personal settings belong to the person, not to a workspace: they live on
    // the (globally unique) users row, so both sides resolve by email alone.
    // Scoping them by organization made a member working outside their home
    // organization read empty settings and write a duplicate users row.
    async getUserSettings(email, ctx) {
      const row = await getUserByEmailGlobal(email);
      return row?.settings || {};
    }

    async setUserSettings(email, data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const existing = await getUserByEmailGlobal(email);

      if (existing) {
        await db
          .updateTable('users')
          .set({
            settings: jsonb(data),
            updated_at: now(),
          })
          .where('id', '=', existing.id)
          .execute();
      } else {
        await db
          .insertInto('users')
          .values({
            organization_id: orgId,
            email: email.toLowerCase(),
            settings: jsonb(data),
          })
          .execute();
      }

      return data;
    }
  };
}