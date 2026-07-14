/**
 * Migration to add tagging system for presentations.
 * Tags are organization-scoped and can be applied to presentations.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Create tags table
  await db.schema
    .createTable('tags')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Unique constraint: tag names must be unique within an organization
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_org_name
    ON tags (organization_id, lower(name))
  `.execute(db);

  // Index for efficient tag lookup
  await db.schema
    .createIndex('idx_tags_org')
    .on('tags')
    .column('organization_id')
    .execute();

  // Create presentation_tags junction table
  await db.schema
    .createTable('presentation_tags')
    .ifNotExists()
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('tag_id', 'uuid', (col) =>
      col.references('tags.id').onDelete('cascade').notNull()
    )
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Primary key on junction table
  await sql`
    ALTER TABLE presentation_tags
    ADD CONSTRAINT pk_presentation_tags PRIMARY KEY (presentation_id, tag_id)
  `.execute(db);

  // Index for efficient tag-based filtering
  await db.schema
    .createIndex('idx_presentation_tags_tag')
    .on('presentation_tags')
    .column('tag_id')
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_presentation_tags_tag').ifExists().execute();
  await db.schema.dropIndex('idx_tags_org').ifExists().execute();
  await sql`DROP INDEX IF EXISTS idx_tags_org_name`.execute(db);

  // Drop tables
  await db.schema.dropTable('presentation_tags').ifExists().execute();
  await db.schema.dropTable('tags').ifExists().execute();
};