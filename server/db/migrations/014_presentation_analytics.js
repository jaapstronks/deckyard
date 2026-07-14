/**
 * Migration for presentation analytics system:
 * - View sessions table for tracking presentation views
 * - Slide views table for per-slide timing data
 * - Analytics snapshots for pre-computed aggregations
 * - Analytics reports for shareable report data
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // ============================================================
  // VIEW SESSIONS - Core tracking of presentation views
  // ============================================================

  await db.schema
    .createTable('view_sessions')
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
    .addColumn('session_token', 'varchar(64)', (col) => col.unique().notNull())
    .addColumn('source_type', 'varchar(20)', (col) => col.notNull())
    .addColumn('source_id', 'varchar(100)')
    .addColumn('viewer_type', 'varchar(20)', (col) => col.notNull())
    .addColumn('viewer_email', 'varchar(320)')
    .addColumn('device_id', 'varchar(100)')
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ended_at', 'timestamptz')
    .addColumn('last_activity_at', 'timestamptz', (col) => col.notNull())
    .addColumn('duration_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('exit_slide_id', 'uuid')
    .addColumn('exit_slide_index', 'integer')
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Index for listing sessions by presentation (main query pattern)
  await db.schema
    .createIndex('idx_view_sessions_presentation_started')
    .on('view_sessions')
    .columns(['presentation_id', 'started_at'])
    .execute();

  // Index for filtering by source
  await db.schema
    .createIndex('idx_view_sessions_source')
    .on('view_sessions')
    .columns(['source_type', 'source_id'])
    .execute();

  // Index for device-based deduplication
  await db.schema
    .createIndex('idx_view_sessions_device')
    .on('view_sessions')
    .column('device_id')
    .execute();

  // Index for session token lookup (heartbeat updates)
  await db.schema
    .createIndex('idx_view_sessions_token')
    .on('view_sessions')
    .column('session_token')
    .execute();

  // Index for real-time active viewer queries
  await db.schema
    .createIndex('idx_view_sessions_active')
    .on('view_sessions')
    .columns(['presentation_id', 'last_activity_at'])
    .where('ended_at', 'is', null)
    .execute();

  // ============================================================
  // SLIDE VIEWS - Per-slide timing data
  // ============================================================

  await db.schema
    .createTable('slide_views')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('view_session_id', 'uuid', (col) =>
      col.references('view_sessions.id').onDelete('cascade').notNull()
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('slide_id', 'uuid', (col) => col.notNull())
    .addColumn('slide_index', 'integer', (col) => col.notNull())
    .addColumn('entered_at', 'timestamptz', (col) => col.notNull())
    .addColumn('exited_at', 'timestamptz')
    .addColumn('duration_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('visit_number', 'integer', (col) => col.defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Index for session lookup
  await db.schema
    .createIndex('idx_slide_views_session')
    .on('slide_views')
    .column('view_session_id')
    .execute();

  // Index for slide engagement queries
  await db.schema
    .createIndex('idx_slide_views_presentation_slide')
    .on('slide_views')
    .columns(['presentation_id', 'slide_id'])
    .execute();

  // ============================================================
  // ANALYTICS SNAPSHOTS - Pre-computed aggregations
  // ============================================================

  await db.schema
    .createTable('analytics_snapshots')
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
    .addColumn('period_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('period_start', 'timestamptz', (col) => col.notNull())
    .addColumn('period_end', 'timestamptz', (col) => col.notNull())
    .addColumn('total_views', 'integer', (col) => col.defaultTo(0))
    .addColumn('unique_viewers', 'integer', (col) => col.defaultTo(0))
    .addColumn('avg_duration_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('slide_metrics', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('poll_engagement_rate', sql`decimal(5,4)`)
    .addColumn('feedback_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('question_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('computed_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Index for snapshot lookup
  await db.schema
    .createIndex('idx_analytics_snapshots_presentation_period')
    .on('analytics_snapshots')
    .columns(['presentation_id', 'period_type', 'period_start'])
    .execute();

  // ============================================================
  // ANALYTICS REPORTS - Shareable report data
  // ============================================================

  await db.schema
    .createTable('analytics_reports')
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
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('report_type', 'varchar(30)', (col) => col.notNull())
    .addColumn('start_date', 'timestamptz', (col) => col.notNull())
    .addColumn('end_date', 'timestamptz', (col) => col.notNull())
    .addColumn('share_token', 'varchar(64)', (col) => col.unique())
    .addColumn('share_expires_at', 'timestamptz')
    .addColumn('is_public', 'boolean', (col) => col.defaultTo(false))
    .addColumn('report_data', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('generated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('created_by', 'varchar(320)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Index for share token lookup (public access)
  await db.schema
    .createIndex('idx_analytics_reports_share_token')
    .on('analytics_reports')
    .column('share_token')
    .where('share_token', 'is not', null)
    .execute();

  // Index for listing reports by presentation
  await db.schema
    .createIndex('idx_analytics_reports_presentation')
    .on('analytics_reports')
    .columns(['presentation_id', 'created_at'])
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_analytics_reports_presentation').ifExists().execute();
  await db.schema.dropIndex('idx_analytics_reports_share_token').ifExists().execute();
  await db.schema.dropIndex('idx_analytics_snapshots_presentation_period').ifExists().execute();
  await db.schema.dropIndex('idx_slide_views_presentation_slide').ifExists().execute();
  await db.schema.dropIndex('idx_slide_views_session').ifExists().execute();
  await db.schema.dropIndex('idx_view_sessions_active').ifExists().execute();
  await db.schema.dropIndex('idx_view_sessions_token').ifExists().execute();
  await db.schema.dropIndex('idx_view_sessions_device').ifExists().execute();
  await db.schema.dropIndex('idx_view_sessions_source').ifExists().execute();
  await db.schema.dropIndex('idx_view_sessions_presentation_started').ifExists().execute();

  // Drop tables
  await db.schema.dropTable('analytics_reports').ifExists().execute();
  await db.schema.dropTable('analytics_snapshots').ifExists().execute();
  await db.schema.dropTable('slide_views').ifExists().execute();
  await db.schema.dropTable('view_sessions').ifExists().execute();
};