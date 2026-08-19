/**
 * Migration: rename `api_keys.scopes` → `api_keys.permissions`.
 *
 * Vocabulary decision D10 (docs/plans, B41-a): `scope` meant three different
 * things in the codebase — the storage scope an operation acts under, a
 * presentation's visibility, and the capability list on an API key. One word
 * per meaning: the capability list on an API key is its **permissions**
 * (`['read', 'write', …]`), which is also the word the settings UI already
 * used on screen. The column follows the code so the storage layer is not
 * left translating between a wire spelling and a physical one.
 *
 * Values are untouched — the JSONB payload (`["read", "write"]` by default)
 * keeps its exact shape; only the column name changes. `down` is the exact
 * inverse.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`ALTER TABLE api_keys RENAME COLUMN scopes TO permissions`.execute(
    db,
  );
};

export const down = async (db) => {
  await sql`ALTER TABLE api_keys RENAME COLUMN permissions TO scopes`.execute(
    db,
  );
};
