/**
 * The trash list pages by keyset (B821, D358).
 *
 * The trash is ordered by `(trashed_at desc, id desc)` and continues with
 * `WHERE (trashed_at, id) < (:value, :id)`. `trashed_at` needs no NOT NULL:
 * the trash is exactly the rows where it is set. No index served the list:
 * the planner read the organization's decks and sorted. This adds the scope
 * followed by the full keyset, partial on the trashed decks:
 * `(organization_id, trashed_at DESC, id DESC) WHERE trashed_at IS NOT NULL`.
 *
 * Both directions are idempotent.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_presentations_trash_keyset
    ON presentations (organization_id, trashed_at DESC, id DESC)
    WHERE trashed_at IS NOT NULL
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_presentations_trash_keyset`.execute(db);
};
