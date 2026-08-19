/**
 * Migration: drop the two dead analytics tables `analytics_snapshots` (created
 * in 014) and `aggregate_analytics` (created in 024).
 *
 * Both were designed as caching layers — `analytics_snapshots` for
 * "pre-computed aggregations", `aggregate_analytics` for "privacy-safe
 * pre-computed metrics" — and neither was ever wired. As of this commit there
 * is not one reader and not one writer for either table anywhere outside the
 * migrations that create them: every analytics metric is aggregated live from
 * `view_sessions` + `slide_views` on each request (see
 * `docs/reference/analytics.md` § *Flows*). The "deliberately kept" note that
 * migration 066 left on `aggregate_analytics` kept a caching design alive on
 * paper that no measurement ever asked for.
 *
 * The beta stance settles it (`docs/reference/versioning.md` § *The beta
 * stance: purity over compatibility*): a schema that implies a caching layer
 * which does not exist is drift, and drift goes rather than being half-kept.
 * If a snapshot/aggregate path is ever wanted, it is a fresh design against the
 * cost measured at that time — not a resurrection of these shapes.
 *
 * No data is lost that anyone can act on: neither table has ever been written,
 * so both are empty on every instance, and no query references them after this
 * commit.
 *
 * `down` restores both tables and their indexes exactly as 014 and 024 declared
 * them (nullable FK columns, cascade on delete, the same unique/lookup
 * indexes). It does not restore rows — there never were any.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // aggregate_analytics (024)
  await sql`DROP INDEX IF EXISTS idx_aggregate_analytics_org`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_aggregate_analytics_unique`.execute(db);
  await db.schema.dropTable('aggregate_analytics').ifExists().execute();

  // analytics_snapshots (014)
  await db.schema
    .dropIndex('idx_analytics_snapshots_presentation_period')
    .ifExists()
    .execute();
  await db.schema.dropTable('analytics_snapshots').ifExists().execute();
};

export const down = async (db) => {
  // Recreate analytics_snapshots as migration 014 declared it.
  await db.schema
    .createTable('analytics_snapshots')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade'),
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull(),
    )
    .addColumn('period_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('period_start', 'timestamptz', (col) => col.notNull())
    .addColumn('period_end', 'timestamptz', (col) => col.notNull())
    .addColumn('total_views', 'integer', (col) => col.defaultTo(0))
    .addColumn('unique_viewers', 'integer', (col) => col.defaultTo(0))
    .addColumn('avg_duration_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('slide_metrics', 'jsonb', (col) =>
      col.defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('poll_engagement_rate', sql`decimal(5,4)`)
    .addColumn('feedback_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('question_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('computed_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_analytics_snapshots_presentation_period')
    .on('analytics_snapshots')
    .columns(['presentation_id', 'period_type', 'period_start'])
    .execute();

  // Recreate aggregate_analytics as migration 024 declared it.
  await db.schema
    .createTable('aggregate_analytics')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade'),
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull(),
    )
    .addColumn('period_date', 'date', (col) => col.notNull())
    .addColumn('period_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('viewer_category', 'varchar(20)', (col) => col.notNull())
    .addColumn('view_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('unique_viewers', 'integer', (col) => col.defaultTo(0))
    .addColumn('avg_duration_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('completion_rate', sql`decimal(5,4)`)
    .addColumn('computed_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aggregate_analytics_unique
    ON aggregate_analytics(presentation_id, period_date, period_type, viewer_category)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_aggregate_analytics_org
    ON aggregate_analytics(organization_id, period_date, period_type)
  `.execute(db);
};
