/**
 * The last lists page by keyset (B825, D358): a deck's viewer sessions and
 * analytics reports, an organization's members and the admin user list.
 *
 * Each is ordered by `(<time> desc, id desc)` and continues with
 * `WHERE (<time>, id) < (:value, :id)`. What the tables did not yet
 * guarantee:
 *
 *  - `analytics_reports.created_at`, `user_organizations.created_at` and
 *    `users.created_at` were nullable (only a default). No write path stores
 *    a NULL, but a NULL never compares, so such a row would fall off every
 *    page after the first. A row without one takes the nearest moment it has
 *    (`generated_at`, `joined_at`, `updated_at`), else now(), and the column
 *    becomes NOT NULL. `view_sessions.started_at` already is.
 *  - The deck indexes were `(presentation_id, started_at)` and
 *    `(presentation_id, created_at)`: they lack the `id` tiebreaker. They are
 *    replaced by the scope followed by the full keyset, which also serves the
 *    date-range aggregations the old ones did. Members and users get the
 *    keyset next to their existing organization index.
 *
 * `down` restores the old deck indexes and drops NOT NULL; the backfilled
 * timestamps stay, they are true enough. Both directions are idempotent.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    UPDATE analytics_reports SET created_at = COALESCE(generated_at, now())
    WHERE created_at IS NULL
  `.execute(db);
  await sql`
    UPDATE user_organizations SET created_at = COALESCE(joined_at, now())
    WHERE created_at IS NULL
  `.execute(db);
  await sql`
    UPDATE users SET created_at = COALESCE(updated_at, now())
    WHERE created_at IS NULL
  `.execute(db);
  for (const table of ['analytics_reports', 'user_organizations', 'users']) {
    await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN created_at SET NOT NULL`.execute(
      db,
    );
  }

  await sql`DROP INDEX IF EXISTS idx_view_sessions_presentation_started`.execute(
    db,
  );
  await sql`
    CREATE INDEX IF NOT EXISTS idx_view_sessions_list_keyset
    ON view_sessions (presentation_id, started_at DESC, id DESC)
  `.execute(db);
  await sql`DROP INDEX IF EXISTS idx_analytics_reports_presentation`.execute(
    db,
  );
  await sql`
    CREATE INDEX IF NOT EXISTS idx_analytics_reports_list_keyset
    ON analytics_reports (presentation_id, created_at DESC, id DESC)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_organizations_list_keyset
    ON user_organizations (organization_id, created_at DESC, id DESC)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_list_keyset
    ON users (organization_id, created_at DESC, id DESC)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_users_list_keyset`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_user_organizations_list_keyset`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS idx_analytics_reports_list_keyset`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_analytics_reports_presentation
    ON analytics_reports (presentation_id, created_at)
  `.execute(db);
  await sql`DROP INDEX IF EXISTS idx_view_sessions_list_keyset`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_view_sessions_presentation_started
    ON view_sessions (presentation_id, started_at)
  `.execute(db);
  for (const table of ['analytics_reports', 'user_organizations', 'users']) {
    await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN created_at DROP NOT NULL`.execute(
      db,
    );
  }
};
