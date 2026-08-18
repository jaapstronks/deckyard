/**
 * PostgreSQL presentations storage module.
 *
 * B79 / D34 (tranche 2, PR 1): the presentation CRUD and version-snapshot
 * methods moved to direct Kysely in `server/storage/presentations/index.js`.
 * What remains here are the collab Y.Doc-state methods, reached through the
 * `getStorage` adapter singleton — they leave for
 * `server/storage/presentations/ydocs.js` in PR 2, after which this mixin and
 * the whole adapter class are deleted.
 */

import { getDb, getOrgId, now } from './helpers.js';

/**
 * Presentations mixin - now only the collab Y.Doc-state methods.
 * @param {import('../types.js').AdapterBase} Base
 */
export function withPresentations(Base) {
  return class extends Base {
    async getYDocState(presentationId, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const row = await db
        .selectFrom('presentation_ydocs')
        .select('state')
        .where('presentation_id', '=', presentationId)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (!row?.state) return null;
      return new Uint8Array(row.state);
    }

    async setYDocState(presentationId, state, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);
      const buf = Buffer.from(state);
      const timestamp = now();

      await db
        .insertInto('presentation_ydocs')
        .values({
          presentation_id: presentationId,
          organization_id: orgId,
          state: buf,
          updated_at: timestamp,
        })
        .onConflict((oc) =>
          oc.column('presentation_id').doUpdateSet({
            state: buf,
            updated_at: timestamp,
          })
        )
        .execute();
      return true;
    }

    async deleteYDocState(presentationId, ctx) {
      const db = getDb();
      const orgId = getOrgId(ctx);

      const result = await db
        .deleteFrom('presentation_ydocs')
        .where('presentation_id', '=', presentationId)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();
      return Number(result?.numDeletedRows || 0) > 0;
    }
  };
}
