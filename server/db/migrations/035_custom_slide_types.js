/**
 * Migration: Custom Slide Types
 * Adds table for organization-scoped custom slide type definitions.
 * Allows designers to create custom slide types without modifying code.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema
    .createTable('custom_slide_types')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').notNull()
    )
    .addColumn('slug', 'varchar(80)', (col) => col.notNull())
    .addColumn('label', 'varchar(255)', (col) => col.notNull())
    .addColumn('base_type', 'varchar(80)')
    // Field schema: array of field definitions
    .addColumn('fields', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    // Default content values
    .addColumn('defaults', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    // Per-language defaults
    .addColumn('defaults_by_lang', 'jsonb')
    // Safe template string (Handlebars-like subset)
    .addColumn('template', 'text')
    // Custom CSS for the slide type
    .addColumn('css', 'text')
    // Whether this type is published/available for use
    .addColumn('is_published', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .execute();

  // Unique constraint: one slug per organization
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_slide_types_org_slug
    ON custom_slide_types(organization_id, slug)
  `.execute(db);

  // Index for listing by organization
  await db.schema
    .createIndex('idx_custom_slide_types_org')
    .on('custom_slide_types')
    .column('organization_id')
    .execute();

  // Partial index for published types (fast filtering)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_custom_slide_types_published
    ON custom_slide_types(organization_id)
    WHERE is_published = true
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_custom_slide_types_published`.execute(db);
  await db.schema.dropIndex('idx_custom_slide_types_org').ifExists().execute();
  await sql`DROP INDEX IF EXISTS idx_custom_slide_types_org_slug`.execute(db);
  await db.schema.dropTable('custom_slide_types').ifExists().execute();
};
