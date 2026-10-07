/**
 * Seeded view history for a sandbox guest's example copy (B353).
 *
 * The one writer that puts view sessions on a deck nobody viewed: the history
 * `server/sandbox/analytics.js` builds from an example's declared profile. It
 * refuses outside `SANDBOX_MODE` on its own, so a normal installation cannot
 * get invented numbers whichever route calls it.
 */

import crypto from 'node:crypto';
import { sandboxEnabled } from '../../config/sandbox.js';
import { withDbGuard } from '../utils/index.js';
import { toStorageContext } from '../scope.js';
import { VIEWER_TYPES } from './view-sessions.js';

/**
 * Insert a built view history for one presentation of the scope's
 * organization: each session with its slide views, in one transaction.
 *
 * @param {import('../scope.js').StorageScope} scope - The guest's scope.
 * @param {string} presentationId - The guest's copy.
 * @param {ReturnType<typeof import('../../sandbox/analytics.js').buildSeedSessions>} sessions
 * @returns {Promise<{sessions:number}>} How many sessions were written; 0
 *   outside sandbox mode, without a database, or when the presentation is not
 *   in the scope's organization.
 */
export async function insertSeededViewSessions(
  scope,
  presentationId,
  sessions,
) {
  if (!sandboxEnabled()) return { sessions: 0 };
  const ctx = toStorageContext(scope, 'insertSeededViewSessions');
  if (!presentationId || !Array.isArray(sessions) || !sessions.length) {
    return { sessions: 0 };
  }

  return withDbGuard({ sessions: 0 }, async (db) => {
    const owned = await db
      .selectFrom('presentations')
      .select('id')
      .where('id', '=', presentationId)
      .where('organization_id', '=', ctx.organizationId)
      .executeTakeFirst();
    if (!owned) return { sessions: 0 };

    return db.transaction().execute(async (trx) => {
      for (const session of sessions) {
        const row = await trx
          .insertInto('view_sessions')
          .values({
            presentation_id: presentationId,
            session_token: crypto.randomBytes(32).toString('hex'),
            source_type: session.sourceType,
            source_id: null,
            viewer_type: VIEWER_TYPES.ANONYMOUS,
            viewer_email: null,
            device_id: session.deviceId,
            started_at: session.startedAt,
            ended_at: session.endedAt,
            last_activity_at: session.endedAt,
            duration_seconds: session.durationSeconds,
            exit_slide_id: session.exitSlideId,
            exit_slide_index: session.exitSlideIndex,
            ip_address: null,
            user_agent: null,
            attribution_allowed: false,
            created_at: session.startedAt,
          })
          .returning('id')
          .executeTakeFirst();
        if (!session.slideViews.length) continue;
        await trx
          .insertInto('slide_views')
          .values(
            session.slideViews.map((view) => ({
              view_session_id: row.id,
              presentation_id: presentationId,
              slide_id: view.slideId,
              slide_index: view.slideIndex,
              entered_at: view.enteredAt,
              exited_at: view.exitedAt,
              duration_seconds: view.durationSeconds,
              visit_number: view.visitNumber,
              created_at: view.enteredAt,
            })),
          )
          .execute();
      }
      return { sessions: sessions.length };
    });
  });
}
