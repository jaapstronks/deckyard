/**
 * Migration for activity events system:
 * - Activity events table for tracking workspace activity
 * - User event reads table for "seen" tracking
 * - Notification queue for smart delivery
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Core activity events table
  await db.schema
    .createTable('activity_events')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('event_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('entity_type', 'varchar(30)', (col) => col.notNull())
    .addColumn('entity_id', 'uuid', (col) => col.notNull())
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade')
    )
    .addColumn('actor_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('actor_name', 'varchar(255)')
    .addColumn('actor_type', 'varchar(20)', (col) => col.defaultTo('user'))
    .addColumn('data', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Index for listing events by organization (main query pattern)
  await db.schema
    .createIndex('idx_activity_events_org_created')
    .on('activity_events')
    .columns(['organization_id', 'created_at'])
    .execute();

  // Index for filtering by presentation
  await db.schema
    .createIndex('idx_activity_events_presentation')
    .on('activity_events')
    .column('presentation_id')
    .execute();

  // Index for filtering by event type
  await db.schema
    .createIndex('idx_activity_events_type')
    .on('activity_events')
    .columns(['organization_id', 'event_type', 'created_at'])
    .execute();

  // Index for filtering by actor (for "my activity" queries)
  await db.schema
    .createIndex('idx_activity_events_actor')
    .on('activity_events')
    .columns(['organization_id', 'actor_email', 'created_at'])
    .execute();

  // User read tracking table
  await db.schema
    .createTable('user_event_reads')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('user_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('last_read_event_id', 'uuid', (col) =>
      col.references('activity_events.id').onDelete('set null')
    )
    .addColumn('last_read_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Unique constraint for one read-marker per user per org
  await db.schema
    .createIndex('idx_user_event_reads_unique')
    .on('user_event_reads')
    .columns(['organization_id', 'user_email'])
    .unique()
    .execute();

  // Notification queue table
  await db.schema
    .createTable('notification_queue')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('recipient_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('event_id', 'uuid', (col) =>
      col.references('activity_events.id').onDelete('cascade')
    )
    .addColumn('channel', 'varchar(20)', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.defaultTo('pending'))
    .addColumn('suppression_reason', 'varchar(50)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('processed_at', 'timestamptz')
    .execute();

  // Index for processing pending notifications
  await db.schema
    .createIndex('idx_notification_queue_pending')
    .on('notification_queue')
    .columns(['status', 'created_at'])
    .where('status', '=', 'pending')
    .execute();

  // Index for recipient lookup (for suppression checks)
  await db.schema
    .createIndex('idx_notification_queue_recipient')
    .on('notification_queue')
    .columns(['recipient_email', 'event_id'])
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_notification_queue_recipient').ifExists().execute();
  await db.schema.dropIndex('idx_notification_queue_pending').ifExists().execute();
  await db.schema.dropIndex('idx_user_event_reads_unique').ifExists().execute();
  await db.schema.dropIndex('idx_activity_events_actor').ifExists().execute();
  await db.schema.dropIndex('idx_activity_events_type').ifExists().execute();
  await db.schema.dropIndex('idx_activity_events_presentation').ifExists().execute();
  await db.schema.dropIndex('idx_activity_events_org_created').ifExists().execute();

  // Drop tables
  await db.schema.dropTable('notification_queue').ifExists().execute();
  await db.schema.dropTable('user_event_reads').ifExists().execute();
  await db.schema.dropTable('activity_events').ifExists().execute();
};