/**
 * Migration to add per-user slide-library usage tracking.
 *
 * Records when a user first used a library slide or collection as a starting
 * point for a deck (compose or insert-into-existing). Powers the Home
 * building-blocks "new to you" badge: a team item the current user has never
 * used is flagged; the flag clears after first use.
 *
 * - slide_library_usage: one row per (organization, user, item_type, item_id).
 *   `item_id` references either a slide_library row or a slide_collections row
 *   depending on `item_type`; it carries no FK (a deleted item just stops
 *   matching), so the two possible parents don't complicate the schema.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema
    .createTable('slide_library_usage')
    .ifNotExists()
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').notNull()
    )
    .addColumn('user_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('item_type', 'varchar(20)', (col) => col.notNull())
    .addColumn('item_id', 'varchar(200)', (col) => col.notNull())
    .addColumn('first_used_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('use_count', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // One row per user per item; the upsert conflict target.
  await sql`
    ALTER TABLE slide_library_usage
    ADD CONSTRAINT pk_slide_library_usage
    PRIMARY KEY (organization_id, user_email, item_type, item_id)
  `.execute(db);

  // Index for reading a user's used set within an org.
  await db.schema
    .createIndex('idx_slide_library_usage_org_user')
    .on('slide_library_usage')
    .columns(['organization_id', 'user_email'])
    .execute();
};

export const down = async (db) => {
  await db.schema.dropIndex('idx_slide_library_usage_org_user').ifExists().execute();
  await db.schema.dropTable('slide_library_usage').ifExists().execute();
};
