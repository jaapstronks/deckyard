/**
 * Migration for user notifications:
 * - Creates table to store in-app notifications for users
 * - Supports notification types: share_received, comment_mention, etc.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Create user_notifications table
  await db.schema
    .createTable('user_notifications')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('user_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('notification_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('body', 'text')
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade')
    )
    .addColumn('actor_email', 'varchar(320)')
    .addColumn('actor_name', 'varchar(255)')
    .addColumn('data', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('action_url', 'varchar(500)')
    .addColumn('is_read', 'boolean', (col) => col.defaultTo(false))
    .addColumn('read_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`now()`)
    )
    .execute();

  // Index for fetching user notifications (with read status and date ordering)
  await sql`
    CREATE INDEX idx_user_notifications_user
    ON user_notifications(user_email, organization_id, is_read, created_at DESC)
  `.execute(db);

  // Partial index for unread notifications (faster unread count queries)
  await sql`
    CREATE INDEX idx_user_notifications_unread
    ON user_notifications(user_email, organization_id, created_at DESC)
    WHERE is_read = FALSE
  `.execute(db);
};

export const down = async (db) => {
  await db.schema.dropTable('user_notifications').execute();
};