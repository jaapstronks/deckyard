/**
 * The activity feed pages by keyset (B823, D358).
 *
 * The feed is ordered by `(created_at desc, id desc)` and continues with
 * `WHERE (created_at, id) < (:value, :id)`. Two things the table did not yet
 * guarantee:
 *
 *  - `created_at` was nullable (009 gave it only a default). No write path
 *    stores a NULL, but a NULL never compares, so such a row would fall off
 *    every page after the first. The row has no other moment to take, so a
 *    row without one gets now() and the column becomes NOT NULL.
 *  - The list index was `(organization_id, created_at)`: it lacks the `id`
 *    tiebreaker the order and the keyset compare on. It is replaced by the
 *    scope followed by the full keyset, `(organization_id, created_at DESC,
 *    id DESC)`, which also serves everything the old one did.
 *
 * `down` restores the 009 index and drops NOT NULL; the backfilled timestamps
 * stay, they are true enough. Both directions are idempotent.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    UPDATE activity_events SET created_at = now() WHERE created_at IS NULL
  `.execute(db);
  await sql`ALTER TABLE activity_events ALTER COLUMN created_at SET NOT NULL`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS idx_activity_events_org_created`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_activity_events_keyset
    ON activity_events (organization_id, created_at DESC, id DESC)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_activity_events_keyset`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_activity_events_org_created
    ON activity_events (organization_id, created_at)
  `.execute(db);
  await sql`ALTER TABLE activity_events ALTER COLUMN created_at DROP NOT NULL`.execute(
    db,
  );
};
