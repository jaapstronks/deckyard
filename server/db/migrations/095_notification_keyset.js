/**
 * The notification inbox pages by keyset (B819, D357).
 *
 * The list-page contract orders every list by `(<time> desc, id desc)` and
 * continues with `WHERE (created_at, id) < (:value, :id)`. Two things the
 * table did not yet guarantee:
 *
 *  - `created_at` was nullable (012 gave it only a default). A NULL never
 *    compares, so such a row would fall off every page after the first. A row
 *    without one gets the earliest moment it is known to have existed by
 *    (read, archived, or now) and the column becomes NOT NULL.
 *  - The list index was `(user_email, organization_id, is_read, created_at
 *    DESC)`: `is_read` between the scope and the order means the inbox
 *    ("all") could not walk it in order. It is replaced by the scope followed
 *    by the full keyset, `(user_email, organization_id, created_at DESC, id
 *    DESC)`. The partial unread index (badge count, mark-all-read) stays.
 *
 * `down` restores the 012 index and drops NOT NULL; the backfilled timestamps
 * stay, they are true enough. Both directions are idempotent.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    UPDATE user_notifications
    SET created_at = COALESCE(read_at, archived_at, now())
    WHERE created_at IS NULL
  `.execute(db);
  await sql`ALTER TABLE user_notifications ALTER COLUMN created_at SET NOT NULL`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS idx_user_notifications_user`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_notifications_keyset
    ON user_notifications (user_email, organization_id, created_at DESC, id DESC)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_user_notifications_keyset`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_notifications_user
    ON user_notifications (user_email, organization_id, is_read, created_at DESC)
  `.execute(db);
  await sql`ALTER TABLE user_notifications ALTER COLUMN created_at DROP NOT NULL`.execute(
    db,
  );
};
