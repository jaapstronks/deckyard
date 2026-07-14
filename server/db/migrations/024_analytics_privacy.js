/**
 * Migration for analytics privacy controls:
 * - Add is_internal and attribution_allowed columns to view_sessions
 * - Create aggregate_analytics table for privacy-safe pre-computed metrics
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // ============================================================
  // VIEW SESSIONS - Add privacy columns
  // ============================================================

  // Add is_internal column (true if viewer is authenticated team member)
  await sql`
    ALTER TABLE view_sessions
    ADD COLUMN IF NOT EXISTS is_internal boolean DEFAULT false
  `.execute(db);

  // Add attribution_allowed column (true if viewer opted into having name shown)
  await sql`
    ALTER TABLE view_sessions
    ADD COLUMN IF NOT EXISTS attribution_allowed boolean DEFAULT false
  `.execute(db);

  // Index for querying internal vs external views
  await sql`
    CREATE INDEX IF NOT EXISTS idx_view_sessions_internal
    ON view_sessions(presentation_id, is_internal, started_at)
  `.execute(db);

  // ============================================================
  // AGGREGATE ANALYTICS - Privacy-safe pre-computed metrics
  // ============================================================

  await db.schema
    .createTable('aggregate_analytics')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('period_date', 'date', (col) => col.notNull())
    .addColumn('period_type', 'varchar(10)', (col) => col.notNull()) // 'day' | 'week' | 'month'
    .addColumn('viewer_category', 'varchar(20)', (col) => col.notNull()) // 'internal' | 'external'
    .addColumn('view_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('unique_viewers', 'integer', (col) => col.defaultTo(0))
    .addColumn('avg_duration_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('completion_rate', sql`decimal(5,4)`)
    .addColumn('computed_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Unique constraint for upsert operations
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aggregate_analytics_unique
    ON aggregate_analytics(presentation_id, period_date, period_type, viewer_category)
  `.execute(db);

  // Index for organization-wide queries (admin dashboards)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_aggregate_analytics_org
    ON aggregate_analytics(organization_id, period_date, period_type)
  `.execute(db);
};

export const down = async (db) => {
  // Drop aggregate_analytics indexes and table
  await sql`DROP INDEX IF EXISTS idx_aggregate_analytics_org`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_aggregate_analytics_unique`.execute(db);
  await db.schema.dropTable('aggregate_analytics').ifExists().execute();

  // Drop view_sessions privacy columns
  await sql`DROP INDEX IF EXISTS idx_view_sessions_internal`.execute(db);
  await sql`ALTER TABLE view_sessions DROP COLUMN IF EXISTS attribution_allowed`.execute(db);
  await sql`ALTER TABLE view_sessions DROP COLUMN IF EXISTS is_internal`.execute(db);
};
