/**
 * Migration for share link guest verification:
 * - Guest records with email verification for share link access
 * - Session tokens for persistent guest sessions
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Share link guests table for email-verified guest access
  await db.schema
    .createTable('share_link_guests')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').notNull()
    )
    .addColumn('share_link_id', 'uuid', (col) =>
      col.references('presentation_share_links.id').onDelete('cascade').notNull()
    )
    .addColumn('email', 'varchar(320)', (col) => col.notNull())
    .addColumn('name', 'varchar(255)')
    .addColumn('verification_token', 'varchar(64)')
    .addColumn('verification_token_expires_at', 'timestamptz')
    .addColumn('verified_at', 'timestamptz')
    .addColumn('session_token', 'varchar(64)')
    .addColumn('session_expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('last_accessed_at', 'timestamptz')
    .execute();

  // Unique constraint: one guest per email per share link
  await sql`
    ALTER TABLE share_link_guests
    ADD CONSTRAINT share_link_guests_unique_email
    UNIQUE (share_link_id, email)
  `.execute(db);

  // Index for verification token lookup (only non-null tokens)
  await db.schema
    .createIndex('idx_share_link_guests_verification')
    .on('share_link_guests')
    .column('verification_token')
    .where('verification_token', 'is not', null)
    .execute();

  // Index for session token lookup (only non-null tokens)
  await db.schema
    .createIndex('idx_share_link_guests_session')
    .on('share_link_guests')
    .column('session_token')
    .where('session_token', 'is not', null)
    .execute();

  // Index for rate limiting verification requests by email
  await db.schema
    .createIndex('idx_share_link_guests_email_created')
    .on('share_link_guests')
    .columns(['email', 'created_at'])
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_share_link_guests_email_created').ifExists().execute();
  await db.schema.dropIndex('idx_share_link_guests_session').ifExists().execute();
  await db.schema.dropIndex('idx_share_link_guests_verification').ifExists().execute();

  // Drop table
  await db.schema.dropTable('share_link_guests').ifExists().execute();
};