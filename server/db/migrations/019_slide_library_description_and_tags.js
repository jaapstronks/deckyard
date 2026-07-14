/**
 * Migration to add description and tagging system for slide library.
 * - Adds description column to slide_library table
 * - Creates slide_library_tags junction table (reuses existing tags)
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Add description column to slide_library
  await db.schema
    .alterTable('slide_library')
    .addColumn('description', 'text')
    .execute();

  // Create slide_library_tags junction table
  await db.schema
    .createTable('slide_library_tags')
    .ifNotExists()
    .addColumn('slide_library_id', 'uuid', (col) =>
      col.references('slide_library.id').onDelete('cascade').notNull()
    )
    .addColumn('tag_id', 'uuid', (col) =>
      col.references('tags.id').onDelete('cascade').notNull()
    )
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Primary key on junction table
  await sql`
    ALTER TABLE slide_library_tags
    ADD CONSTRAINT pk_slide_library_tags PRIMARY KEY (slide_library_id, tag_id)
  `.execute(db);

  // Index for efficient tag-based filtering
  await db.schema
    .createIndex('idx_slide_library_tags_tag')
    .on('slide_library_tags')
    .column('tag_id')
    .execute();
};

export const down = async (db) => {
  // Drop index first
  await db.schema.dropIndex('idx_slide_library_tags_tag').ifExists().execute();

  // Drop junction table
  await db.schema.dropTable('slide_library_tags').ifExists().execute();

  // Remove description column
  await db.schema
    .alterTable('slide_library')
    .dropColumn('description')
    .execute();
};