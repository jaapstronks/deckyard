/**
 * The deck list pages by keyset (B820, D358).
 *
 * The deck list is ordered by `(modified_at desc, id desc)` and continues with
 * `WHERE (modified_at, id) < (:value, :id)`. Two things the table did not yet
 * guarantee:
 *
 *  - `modified_at` was nullable (001 gave it only a default). No write path
 *    stores a NULL, but a NULL never compares, so such a row would fall off
 *    every page after the first. A row without one gets its creation moment
 *    (or now) and the column becomes NOT NULL.
 *  - No index served the list: `idx_presentations_modified` (002) is
 *    `(modified_at desc)` over every organization and every trashed deck,
 *    and the planner preferred it, filtering and re-sorting on `id`. It is
 *    replaced by the scope followed by the full keyset, partial on the
 *    untrashed decks every list reads: `(organization_id, modified_at DESC,
 *    id DESC) WHERE trashed_at IS NULL`. Every other read that orders decks
 *    on `modified_at` (image-library usage, the analytics "recent" order) is
 *    scoped the same way, so none loses its index.
 *
 * `down` restores the 002 index and drops NOT NULL; the backfilled
 * timestamps stay, they are true enough. Both directions are idempotent.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    UPDATE presentations
    SET modified_at = COALESCE(created_at, now())
    WHERE modified_at IS NULL
  `.execute(db);
  await sql`ALTER TABLE presentations ALTER COLUMN modified_at SET NOT NULL`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS idx_presentations_modified`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_presentations_list_keyset
    ON presentations (organization_id, modified_at DESC, id DESC)
    WHERE trashed_at IS NULL
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_presentations_list_keyset`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_presentations_modified
    ON presentations (modified_at DESC)
  `.execute(db);
  await sql`ALTER TABLE presentations ALTER COLUMN modified_at DROP NOT NULL`.execute(
    db,
  );
};
