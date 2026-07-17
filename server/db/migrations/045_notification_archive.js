/**
 * Archive state on the events inbox (phase 5 of the comments &
 * notifications plan).
 *
 * Two orthogonal per-item states: `is_read`/`read_at` = "seen" (drives the
 * bell badge), `archived_at` = "handled" (drops the item from the default
 * inbox list). "Seen but still to do" is exactly an unarchived read item.
 * Replying in a thread auto-archives your open items for that thread; new
 * activity creates a fresh (unarchived) item.
 */

export const up = async (db) => {
  await db.schema
    .alterTable('user_notifications')
    .addColumn('archived_at', 'timestamptz')
    .execute();
};

export const down = async (db) => {
  await db.schema
    .alterTable('user_notifications')
    .dropColumn('archived_at')
    .execute();
};
