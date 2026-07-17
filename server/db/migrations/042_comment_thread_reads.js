import { sql } from 'kysely';

/**
 * Per-user read-state for comment threads (phase 2 of the comments &
 * notifications plan).
 *
 * One row per (user, top-level comment): `last_read_at` is bumped whenever
 * the user views the thread in the comments panel. A thread is unread for a
 * user when its latest activity (top-level comment or newest reply) is newer
 * than their `last_read_at`, or when no row exists. Guests have no account
 * and therefore no rows — the panel shows no read-state for them.
 *
 * This is deliberately per-user state NEXT TO the shared presentation data
 * (like the events inbox), not a new thread status: resolve/dismiss stay
 * shared and untouched.
 */

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS comment_thread_reads (
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      user_email VARCHAR(320) NOT NULL,
      comment_id UUID NOT NULL REFERENCES presentation_comments(id) ON DELETE CASCADE,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_email, comment_id)
    )
  `.execute(db);

  // The FK cascade on comment deletion needs this to avoid a table scan.
  await db.schema
    .createIndex('idx_comment_thread_reads_comment')
    .ifNotExists()
    .on('comment_thread_reads')
    .column('comment_id')
    .execute();
};

export const down = async (db) => {
  await db.schema.dropIndex('idx_comment_thread_reads_comment').ifExists().execute();
  await db.schema.dropTable('comment_thread_reads').ifExists().execute();
};
