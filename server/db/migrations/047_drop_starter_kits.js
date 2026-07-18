/**
 * Migration to drop starter-kit support from presentations.
 *
 * Starter kits are retired in favour of library-first reuse (duplicate a whole
 * deck, compose from the slide library, or start from a collection). The
 * per-deck `is_starter_kit` flag and its filtering index add nothing over those
 * mechanisms, so both are removed. Former starter-kit decks become normal
 * workspace decks (editable/duplicable under the usual workspace rules).
 *
 * The drop is destructive: the flag value is not preserved. `down()` re-adds a
 * nullable column (default false) and the index for reversibility, but cannot
 * restore which decks were flagged.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_presentations_starter_kit`.execute(db);

  await db.schema
    .alterTable('presentations')
    .dropColumn('is_starter_kit')
    .execute();
};

export const down = async (db) => {
  await db.schema
    .alterTable('presentations')
    .addColumn('is_starter_kit', 'boolean', (col) => col.defaultTo(false))
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_presentations_starter_kit
    ON presentations (organization_id, is_starter_kit)
    WHERE is_starter_kit = true
  `.execute(db);
};
