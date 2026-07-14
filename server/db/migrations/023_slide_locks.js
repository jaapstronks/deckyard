/**
 * Migration to add slide_locks table for concurrent editing support.
 *
 * Slide-level locking allows multiple users to edit different slides
 * in the same presentation simultaneously, while preventing conflicts
 * when two users try to edit the same slide.
 *
 * Locks have a TTL (time-to-live) and auto-expire if not refreshed.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS slide_locks (
      id SERIAL PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      slide_id TEXT NOT NULL,
      holder_email TEXT NOT NULL,
      holder_name TEXT,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      organization_id TEXT,
      UNIQUE(presentation_id, slide_id)
    )
  `.execute(db);

  // Index for quick lookups by presentation
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_locks_presentation
    ON slide_locks(presentation_id)
  `.execute(db);

  // Index for cleanup of expired locks
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_locks_expires
    ON slide_locks(expires_at)
  `.execute(db);

  // Index for releasing all locks by user (e.g., on disconnect)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_locks_holder
    ON slide_locks(holder_email)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_slide_locks_holder`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_slide_locks_expires`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_slide_locks_presentation`.execute(db);
  await sql`DROP TABLE IF EXISTS slide_locks`.execute(db);
};