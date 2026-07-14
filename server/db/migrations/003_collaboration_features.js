/**
 * Migration for collaboration features:
 * - Persistent presentation locks (turn-based editing)
 * - Lock request queue (access handoff workflow)
 * - Presentation comments (slide annotations)
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Persistent edit locks (replaces in-memory Map)
  await db.schema
    .createTable('presentation_locks')
    .ifNotExists()
    .addColumn('presentation_id', 'uuid', (col) =>
      col.primaryKey().references('presentations.id').onDelete('cascade')
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('holder_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('holder_name', 'varchar(255)')
    .addColumn('acquired_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('refreshed_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute();

  // Index for efficient cleanup of expired locks
  await db.schema
    .createIndex('idx_presentation_locks_expires')
    .on('presentation_locks')
    .column('expires_at')
    .execute();

  // Lock request queue for access handoff workflow
  await db.schema
    .createTable('lock_requests')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade')
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('requester_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('requester_name', 'varchar(255)')
    .addColumn('message', 'text')
    .addColumn('status', 'varchar(20)', (col) => col.defaultTo('pending'))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('resolved_at', 'timestamptz')
    .execute();

  // Index for querying pending requests per presentation
  await db.schema
    .createIndex('idx_lock_requests_presentation_status')
    .on('lock_requests')
    .columns(['presentation_id', 'status'])
    .execute();

  // Presentation comments / annotations
  await sql`
    CREATE TABLE IF NOT EXISTS presentation_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      presentation_id UUID REFERENCES presentations(id) ON DELETE CASCADE,
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      slide_id UUID,
      parent_id UUID REFERENCES presentation_comments(id) ON DELETE CASCADE,
      author_email VARCHAR(320) NOT NULL,
      author_name VARCHAR(255),
      body TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'open',
      resolved_by VARCHAR(320),
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `.execute(db);

  // Indexes for efficient comment queries
  await db.schema
    .createIndex('idx_comments_presentation_status')
    .on('presentation_comments')
    .columns(['presentation_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_comments_slide')
    .on('presentation_comments')
    .column('slide_id')
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_comments_slide').ifExists().execute();
  await db.schema.dropIndex('idx_comments_presentation_status').ifExists().execute();
  await db.schema.dropIndex('idx_lock_requests_presentation_status').ifExists().execute();
  await db.schema.dropIndex('idx_presentation_locks_expires').ifExists().execute();

  // Drop tables in reverse order (respecting foreign keys)
  await db.schema.dropTable('presentation_comments').ifExists().execute();
  await db.schema.dropTable('lock_requests').ifExists().execute();
  await db.schema.dropTable('presentation_locks').ifExists().execute();
};