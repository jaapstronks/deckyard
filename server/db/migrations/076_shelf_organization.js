/**
 * Migration: slide-library & slide-collections `scope` → `shelf`, value
 * `'team'` → `'organization'` — the stored-data half of vocabulary decision
 * D27, B53 sweep (b) (docs/plans, docs/reference/vocabulary.md).
 *
 * D27: `scope` was overloaded. The storage/tenant sense keeps the word
 * (`server/storage/scope.js`); the deck listing filter became `ownership`
 * (sweep (a), #798); and the slide-library / slide-collections axis that says
 * *where a saved slide or collection lives* — a personal shelf or the shared
 * organization shelf — becomes **`shelf`**, with values `'personal' |
 * 'organization'`. This aligns its shared value with the presentation
 * `visibility` axis (migration 074, also `'organization'`) and drops the last
 * `'team'` spelling for the tenant. The beta stance forbids an accepts-both
 * read-time translation seam, so the stored data is rewritten to match the
 * contract (docs/reference/versioning.md).
 *
 * Two tables, each an exact column rename + value remap + index rename:
 *
 * 1. `slide_library.scope` → `slide_library.shelf`; `'team'` → `'organization'`
 *    (`'personal'` untouched). The composite index `idx_slide_library_org_scope`
 *    (migration 002, on `organization_id, scope`) follows the column on rename;
 *    only its name is refreshed to stay truthful.
 * 2. `slide_collections.scope` → `slide_collections.shelf`, same value remap;
 *    index `idx_slide_collections_org_scope` (migration 046) → `_org_shelf`.
 *
 * Neither value is embedded in a jsonb snapshot or activity-event payload (only
 * presentations are version-snapshotted), so there is no jsonb fold to do.
 *
 * `down` restores the old column/index names and maps the values back.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // 1. slide_library: column + values + index name
  await sql`ALTER TABLE slide_library RENAME COLUMN scope TO shelf`.execute(db);
  await sql`UPDATE slide_library SET shelf = 'organization' WHERE shelf = 'team'`.execute(db);
  await sql`ALTER INDEX IF EXISTS idx_slide_library_org_scope RENAME TO idx_slide_library_org_shelf`.execute(db);

  // 2. slide_collections: column + values + index name
  await sql`ALTER TABLE slide_collections RENAME COLUMN scope TO shelf`.execute(db);
  await sql`UPDATE slide_collections SET shelf = 'organization' WHERE shelf = 'team'`.execute(db);
  await sql`ALTER INDEX IF EXISTS idx_slide_collections_org_scope RENAME TO idx_slide_collections_org_shelf`.execute(db);
};

export const down = async (db) => {
  await sql`ALTER INDEX IF EXISTS idx_slide_collections_org_shelf RENAME TO idx_slide_collections_org_scope`.execute(db);
  await sql`UPDATE slide_collections SET shelf = 'team' WHERE shelf = 'organization'`.execute(db);
  await sql`ALTER TABLE slide_collections RENAME COLUMN shelf TO scope`.execute(db);

  await sql`ALTER INDEX IF EXISTS idx_slide_library_org_shelf RENAME TO idx_slide_library_org_scope`.execute(db);
  await sql`UPDATE slide_library SET shelf = 'team' WHERE shelf = 'organization'`.execute(db);
  await sql`ALTER TABLE slide_library RENAME COLUMN shelf TO scope`.execute(db);
};
