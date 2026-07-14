/**
 * Migration for custom themes system:
 * - Themes table for organization-scoped custom themes
 * - Support for logo, colors, and font customization
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // ============================================================
  // THEMES - Organization-scoped custom themes
  // ============================================================

  await db.schema
    .createTable('themes')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').notNull()
    )
    .addColumn('slug', 'varchar(80)', (col) => col.notNull())
    .addColumn('label', 'varchar(255)', (col) => col.notNull())
    .addColumn('logo_url', 'text')
    // Color configuration: { primary, background, textLight, textDark }
    .addColumn('colors', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    // Font configuration: { heading, body }
    .addColumn('fonts', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute();

  // Unique constraint on organization_id + slug
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_themes_org_slug
    ON themes(organization_id, slug)
  `.execute(db);

  // Index for listing themes by organization
  await db.schema
    .createIndex('idx_themes_org')
    .on('themes')
    .column('organization_id')
    .execute();

  // Index for finding default theme
  await sql`
    CREATE INDEX IF NOT EXISTS idx_themes_default
    ON themes(organization_id)
    WHERE is_default = true
  `.execute(db);
};

export const down = async (db) => {
  // Drop indexes first
  await sql`DROP INDEX IF EXISTS idx_themes_default`.execute(db);
  await db.schema.dropIndex('idx_themes_org').ifExists().execute();
  await sql`DROP INDEX IF EXISTS idx_themes_org_slug`.execute(db);

  // Drop table
  await db.schema.dropTable('themes').ifExists().execute();
};
