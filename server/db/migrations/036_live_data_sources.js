/**
 * Migration: Live Data Sources
 * Adds data_source JSONB column to slide_library for library-level data bindings.
 * Presentation slides store dataSource within the slides JSONB array (no schema change needed).
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Add data_source column to slide_library for always-live library slides
  await sql`
    ALTER TABLE slide_library
    ADD COLUMN IF NOT EXISTS data_source JSONB DEFAULT NULL
  `.execute(db);

  // Index for finding library slides with active data sources
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_library_data_source
    ON slide_library(organization_id)
    WHERE data_source IS NOT NULL
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_slide_library_data_source`.execute(db);
  await sql`ALTER TABLE slide_library DROP COLUMN IF EXISTS data_source`.execute(db);
};
