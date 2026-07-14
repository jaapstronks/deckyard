/**
 * Migration for share link features:
 * - Token-based share links with configurable permissions and expiration
 * - Access logging for analytics
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Share links table for token-based external access
  await db.schema
    .createTable('presentation_share_links')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('token', 'varchar(64)', (col) => col.notNull().unique())
    .addColumn('label', 'varchar(255)')
    .addColumn('permission', 'varchar(20)', (col) => col.notNull())
    .addColumn('password_hash', 'varchar(255)')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('max_uses', 'integer')
    .addColumn('use_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('created_by', 'varchar(320)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revoked_by', 'varchar(320)')
    .execute();

  // Check constraint for valid permissions
  await sql`
    ALTER TABLE presentation_share_links
    ADD CONSTRAINT valid_permission
    CHECK (permission IN ('view', 'comment', 'edit'))
  `.execute(db);

  // Index for finding active links by presentation
  await db.schema
    .createIndex('idx_share_links_presentation')
    .on('presentation_share_links')
    .columns(['presentation_id'])
    .execute();

  // Index for token lookup (unique already creates index, but this filters revoked)
  await db.schema
    .createIndex('idx_share_links_token_active')
    .on('presentation_share_links')
    .column('token')
    .where('revoked_at', 'is', null)
    .execute();

  // Index for expiration cleanup
  await db.schema
    .createIndex('idx_share_links_expires')
    .on('presentation_share_links')
    .column('expires_at')
    .where('expires_at', 'is not', null)
    .execute();

  // Access log table for tracking share link usage
  await db.schema
    .createTable('share_link_access_log')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('share_link_id', 'uuid', (col) =>
      col.references('presentation_share_links.id').onDelete('cascade')
    )
    .addColumn('accessed_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'text')
    .execute();

  // Index for access log queries
  await db.schema
    .createIndex('idx_access_log_link')
    .on('share_link_access_log')
    .column('share_link_id')
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_access_log_link').ifExists().execute();
  await db.schema.dropIndex('idx_share_links_expires').ifExists().execute();
  await db.schema.dropIndex('idx_share_links_token_active').ifExists().execute();
  await db.schema.dropIndex('idx_share_links_presentation').ifExists().execute();

  // Drop tables in reverse order
  await db.schema.dropTable('share_link_access_log').ifExists().execute();
  await db.schema.dropTable('presentation_share_links').ifExists().execute();
};