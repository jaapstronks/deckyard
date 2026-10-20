/**
 * B785: the revoked-link attempt record gets a lifetime, and the author
 * notification stops carrying the accessor's IP.
 *
 * `access_attempt_log` has one reader, the 24-hour notification
 * deduplication in `shouldNotifyAuthor` (server/storage/access-attempts.js),
 * yet every row stayed forever, including the attempts that produced no
 * notification and were never read at all. Since this change only a notified
 * attempt is written and the retention job deletes rows older than the
 * window; this migration clears the backlog at upgrade time rather than at
 * the first job run.
 *
 * `user_notifications.data` on an `access_attempt` row copied that IP into
 * JSON no client reads (the bell shows title and body). The write no longer
 * includes it; this migration strips the key from the rows written before.
 * Rows of every other notification type are not touched.
 *
 * Both statements are idempotent. `down` is a no-op: the deleted rows had no
 * reader and the stripped key had no consumer, so there is nothing to put
 * back.
 */

import { sql } from 'kysely';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('migration-093');

/**
 * The deduplication window, spelled out here so the migration stays what it
 * was when it ran; the live value is `ACCESS_ATTEMPT_WINDOW_MS` in
 * server/storage/access-attempts.js.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export const up = async (db) => {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const attempts = await db
    .deleteFrom('access_attempt_log')
    .where('attempted_at', '<', cutoff)
    .executeTakeFirst();
  log.info(
    `access_attempt_log: ${Number(attempts.numDeletedRows) || 0} row(s) past the window deleted`,
  );

  const notifications = await db
    .updateTable('user_notifications')
    .set({ data: sql`data - 'accessorIp'` })
    .where('notification_type', '=', 'access_attempt')
    .executeTakeFirst();
  log.info(
    `user_notifications: ${Number(notifications.numUpdatedRows) || 0} access_attempt row(s) rewritten without accessorIp`,
  );
};

/** Nothing to undo: no reader of the deleted rows or the stripped key exists. */
export const down = async () => {};
