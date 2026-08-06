/**
 * Migration: drop `view_sessions.is_internal` and its index.
 *
 * The column has existed since migration 024 and only ever held one value:
 * `false`. The public tracking route is deliberately unauthenticated, so it
 * cannot know whether a viewer belongs to the presentation's workspace — it
 * always wrote `is_internal: false`. Every reader that filtered on it (the
 * dashboard `category` param, the weekly-digest `includeTeamAnalytics` option,
 * the viewer-list "team policy" aggregation) was therefore a no-op branch, and
 * the whole internal/external chain is removed in this commit. `analytics.enabled`
 * is now the only tracking switch.
 *
 * Rationale, the measured dead chain, and the revive path (a server-known
 * signal on the track route, not a payload claim) live in
 * `docs/plans/done/decisions.md` § analytics-privacy-naden.
 *
 * `attribution_allowed` (added in the same 024 migration) is kept — it is not
 * part of this seam. The `aggregate_analytics` table was left in place here as
 * "not part of this seam" too, but it was already dead (no reader, no writer);
 * migration 072 drops it along with `analytics_snapshots`.
 *
 * No data is lost that anyone can act on: the column is `false` for every row,
 * no query filters on it after this commit, and it carries no constraint
 * besides the dropped index.
 *
 * `down` restores the column and index as 024 declared them (nullable boolean
 * defaulting to false, composite index on presentation_id/is_internal/started_at).
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_view_sessions_internal`.execute(db);
  await sql`ALTER TABLE view_sessions DROP COLUMN IF EXISTS is_internal`.execute(db);
};

export const down = async (db) => {
  await sql`
    ALTER TABLE view_sessions
    ADD COLUMN IF NOT EXISTS is_internal boolean DEFAULT false
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_view_sessions_internal
    ON view_sessions(presentation_id, is_internal, started_at)
  `.execute(db);
};
