/**
 * Per-language content for slide-library items on Postgres.
 *
 * A slide saved to the library can carry per-language content
 * (`i18n.versions[lang].content`, nl + en-GB). File-mode installs already
 * persist and return it, but the `slide_library` table had no `i18n` column,
 * so DB installs silently dropped it and composed decks fell back to
 * single-language (flat) content. This adds the column so both backends
 * round-trip identically.
 *
 * Nullable with a `'{}'::jsonb` default, mirroring `content`. No backfill:
 * existing rows simply have no per-language content, same as today.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema
    .alterTable('slide_library')
    .addColumn('i18n', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .execute();
};

export const down = async (db) => {
  await db.schema.alterTable('slide_library').dropColumn('i18n').execute();
};
