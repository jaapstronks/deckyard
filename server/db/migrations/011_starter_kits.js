/**
 * Migration to add starter kit support for presentations.
 * Starter kits are workspace presentations that can be viewed and duplicated,
 * but not edited or deleted by non-owners.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema
    .alterTable('presentations')
    .addColumn('is_starter_kit', 'boolean', (col) => col.defaultTo(false).notNull())
    .execute();

  // Create index for efficient filtering of starter kits
  await sql`
    CREATE INDEX IF NOT EXISTS idx_presentations_starter_kit
    ON presentations (organization_id, is_starter_kit)
    WHERE is_starter_kit = true
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_presentations_starter_kit`.execute(db);

  await db.schema
    .alterTable('presentations')
    .dropColumn('is_starter_kit')
    .execute();
};