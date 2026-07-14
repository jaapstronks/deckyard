/**
 * Migration for presentation soft-delete:
 * - Adds trashed_at and trashed_by columns for soft-delete functionality
 * - Follows the same pattern as slide_library which uses these fields
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Add soft-delete columns to presentations table
  await db.schema
    .alterTable('presentations')
    .addColumn('trashed_at', 'timestamptz')
    .addColumn('trashed_by', 'varchar(320)')
    .execute();

  // Index for efficient trash queries (fetch trashed presentations, ordered by trash date)
  await sql`
    CREATE INDEX idx_presentations_trashed
    ON presentations(organization_id, trashed_at DESC)
    WHERE trashed_at IS NOT NULL
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_presentations_trashed`.execute(db);

  await db.schema
    .alterTable('presentations')
    .dropColumn('trashed_at')
    .dropColumn('trashed_by')
    .execute();
};