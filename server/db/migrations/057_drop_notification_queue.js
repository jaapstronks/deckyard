/**
 * Migration: drop the notification_queue table.
 *
 * Migration 009 created it for a "smart delivery" queue that was never wired
 * up: nothing living ever wrote to it or read from it. The only writer was
 * queueCommentNotifications and the only readers were getPendingNotifications /
 * markNotificationSent / suppressNotification — a whole chain with zero live
 * callers, removed alongside this migration.
 *
 * The real notification path (comment emails + in-app notifications + SSE) runs
 * through services/comment-notifications.js and the user_notifications table; it
 * never touched this queue. Two parallel notification designs is exactly the
 * kind of drift the beta stance removes rather than carries forward.
 *
 * Not a breaking change: this is internal storage for a feature that never
 * shipped, not a public contract. `activity_events` and `user_event_reads`
 * (both live) are untouched.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema
    .dropIndex('idx_notification_queue_recipient')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_notification_queue_pending')
    .ifExists()
    .execute();
  await db.schema.dropTable('notification_queue').ifExists().execute();
};

export const down = async (db) => {
  // Recreate the shape migration 009 created, so a rollback lands on a schema
  // the older code can run against. Rows are not restored; nothing read them.
  await db.schema
    .createTable('notification_queue')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade'),
    )
    .addColumn('recipient_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('event_id', 'uuid', (col) =>
      col.references('activity_events.id').onDelete('cascade'),
    )
    .addColumn('channel', 'varchar(20)', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.defaultTo('pending'))
    .addColumn('suppression_reason', 'varchar(50)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('processed_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_notification_queue_pending')
    .on('notification_queue')
    .columns(['status', 'created_at'])
    .where('status', '=', 'pending')
    .execute();

  await db.schema
    .createIndex('idx_notification_queue_recipient')
    .on('notification_queue')
    .columns(['recipient_email', 'event_id'])
    .execute();
};
