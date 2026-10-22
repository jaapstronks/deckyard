/**
 * The comment lists page by keyset (B824, D358).
 *
 * Both lists are ordered by `(created_at desc, id desc)` and continue with
 * `WHERE (created_at, id) < (:value, :id)`: a deck's comments
 * (`presentation_id = :deck`) and the cross-deck recent comments
 * (`organization_id = :org`, top-level only). What the table did not yet
 * guarantee:
 *
 *  - `created_at` was nullable (003 gave it only a default). No write path
 *    stores a NULL, but a NULL never compares, so such a row would fall off
 *    every page after the first. The row has no other moment to take, so a
 *    row without one gets now() and the column becomes NOT NULL.
 *  - There was no index on the order at all. Each list gets its scope
 *    followed by the full keyset: `(presentation_id, created_at DESC, id
 *    DESC)` and `(organization_id, created_at DESC, id DESC)`.
 *
 * `down` drops both indexes and NOT NULL; the backfilled timestamps stay, they
 * are true enough. Both directions are idempotent.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    UPDATE presentation_comments SET created_at = now()
    WHERE created_at IS NULL
  `.execute(db);
  await sql`ALTER TABLE presentation_comments ALTER COLUMN created_at SET NOT NULL`.execute(
    db,
  );
  await sql`
    CREATE INDEX IF NOT EXISTS idx_comments_deck_keyset
    ON presentation_comments (presentation_id, created_at DESC, id DESC)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_comments_org_keyset
    ON presentation_comments (organization_id, created_at DESC, id DESC)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_comments_org_keyset`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_comments_deck_keyset`.execute(db);
  await sql`ALTER TABLE presentation_comments ALTER COLUMN created_at DROP NOT NULL`.execute(
    db,
  );
};
