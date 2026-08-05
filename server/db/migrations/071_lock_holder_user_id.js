/**
 * Migration: give the two lock tables a stable id beside their holder e-mail —
 * the locks + SSE half of the identity epic (T10, PR F3; see
 * docs/plans/briefs/identity-decoupling.md § Restwerk, "F3").
 *
 * PR A/C moved deck authz onto `users.id`, but live-editing locks were still
 * matched as bare lowercased e-mails because the rows had no id half to key on:
 *
 *   - `presentation_locks.holder_email` — the whole-deck turn lock (who holds it,
 *     may refresh/release it) is checked by e-mail in the route and storage.
 *   - `slide_locks.holder_email` — the per-slide lock the concurrent editor takes.
 *
 * This migration lays the id column those comparisons key on, on the 062/063/070
 * template: nullable FK to `users(id)`, `ON DELETE SET NULL`. The write paths
 * stamp both halves from the acting session, so a lock a renamed user holds keeps
 * matching them by id — the rename-robustness F3 buys (a renamed holder used to
 * lose their own lock because the stored e-mail no longer equalled their new one).
 *
 * ## No backfill, and no index — deliberately
 *
 * Unlike 062/063/070, there is **no backfill**. Lock rows are ephemeral: a 2-minute
 * TTL (server/storage/slide-locks.js, presentation-locks-db.js) and a background
 * sweep mean any row present when this migration runs is gone minutes later, and
 * every row written afterwards carries its id from the stamp. Backfilling a table
 * whose contents evaporate would be pure motion. For the same reason these columns
 * get **no index and no unique constraint**: the holder lookups already filter by
 * `(presentation_id[, slide_id])` and fetch the single row, then match the holder
 * in JS — the id column is read off that row, never used as a lookup key.
 *
 * And unlike the persistent dual keys, these pairs are **not** added to
 * `IDENTITY_DUAL_KEYS` (identity-verification.js): that pass verifies backfilled
 * columns where a rename could silently desync a long-lived row. These rows are
 * neither backfilled nor long-lived, and each is stamped from one session object
 * (id and e-mail from the same authed user), so the two halves cannot drift within
 * a lock's lifetime. Scanning an ephemeral table for that invariant buys no signal.
 *
 * `ON DELETE SET NULL` (not CASCADE) for the same reason as 062/063/070: deleting a
 * `users` row must never delete a lock row out from under a live editor — dropping
 * the id link just returns the row to the e-mail path, and the lock expires on its
 * own TTL regardless.
 */

import { sql } from 'kysely';

/** Each id column this migration adds, paired with the table it lives on. */
const TABLES = ['presentation_locks', 'slide_locks'];

export const up = async (db) => {
  for (const table of TABLES) {
    // Nullable FK to the stable user identity. IF NOT EXISTS keeps the whole
    // migration idempotent (re-run safe), matching migrations 062/063/070.
    await sql`
      ALTER TABLE ${sql.table(table)}
      ADD COLUMN IF NOT EXISTS holder_user_id uuid
        REFERENCES users(id) ON DELETE SET NULL
    `.execute(db);
  }
};

export const down = async (db) => {
  for (const table of TABLES) {
    await sql`
      ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS holder_user_id
    `.execute(db);
  }
};
