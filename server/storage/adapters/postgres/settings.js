/**
 * PostgreSQL settings storage module.
 */

import { getDb, getOrgId, jsonb, now, sql } from './helpers.js';

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

    async getUserSettings(email, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('users')
        .select('settings')
        .where('email', '=', email.toLowerCase())
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      return row?.settings || {};
    }

    async setUserSettings(email, data, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const existing = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', email.toLowerCase())
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (existing) {
        await db
          .updateTable('users')
          .set({
            settings: jsonb(data),
            updated_at: now(),
          })
          .where('email', '=', email.toLowerCase())
          .where('organization_id', '=', orgId)
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