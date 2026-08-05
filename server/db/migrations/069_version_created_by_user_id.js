/**
 * Migration: give `presentation_versions.created_by` a stable id beside it —
 * the last first-class identity column of the deck layer to move onto the
 * dual-key form (T10, PR F1; see docs/plans/briefs/identity-decoupling.md
 * § Restwerk, "F1").
 *
 * `created_by` records who *took* a snapshot, and the version list renders it
 * ("Alice, 3 days ago"). It is a first-class column on `presentation_versions`,
 * not part of the embedded `presentation_data` copy — the strip that PR D did
 * to that copy never touched it, and PR G's snapshot backfill left it for here.
 * Today it is a bare e-mail; this migration lays the `users.id` beside it so a
 * rename no longer silently detaches a person from the snapshots they took.
 *
 * It is the exact sibling of migration 063 (which did this for the three
 * `presentations` identity columns) and deliberately **behaviour-preserving**:
 * the snapshot insert stamps the id from the same actor it writes to
 * `created_by`, and every read still shows the e-mail. Nothing keys authz on
 * this column — it is an **audit stamp**, so, unlike migration 067's settings
 * key, it gets no index and no unique constraint. `verifyIdentityConsistency()`
 * (server/storage/identity-verification.js) now covers it, the dual-key
 * invariant it checks holding here for the same reason it holds on 063:
 * `created_by` and `created_by_user_id` are set from one resolution of one
 * address in one statement, so the two halves cannot drift.
 *
 * ## Why nullable, and why `ON DELETE SET NULL`
 *
 * Same reasoning as 062/063. A snapshot's `created_by` can name someone who is
 * not a `users` row on this instance — a legacy version row, or an actor whose
 * account was never provisioned. Those rows keep the id column NULL forever and
 * must keep working; that is the "external" state the resolver names
 * (server/storage/identity-resolver.js). So no NOT NULL and no unique.
 *
 * `ON DELETE SET NULL` (not CASCADE): deleting a `users` row must never delete
 * a version snapshot. Losing the id link just drops the row back to the e-mail
 * path the reads already tolerate; CASCADE would destroy history.
 *
 * ## The backfill is idempotent
 *
 * Each existing row is mapped to `users.id` by its `created_by` e-mail
 * (case-insensitively; the column is normalized on write, the `lower()` is
 * belt-and-braces). The `WHERE created_by_user_id IS NULL` guard makes a re-run
 * a no-op, and e-mails with no `users` row are simply left NULL — the
 * external/legacy path, unchanged, mirroring migration 063's NULL rule.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Nullable FK to the stable user identity. IF NOT EXISTS keeps the migration
  // idempotent (re-run safe), matching migration 063's column adds.
  await sql`
    ALTER TABLE presentation_versions
    ADD COLUMN IF NOT EXISTS created_by_user_id uuid
      REFERENCES users(id) ON DELETE SET NULL
  `.execute(db);

  // Backfill existing rows via the users table. Guarded on created_by_user_id
  // IS NULL so a second run touches nothing; rows whose e-mail has no user row
  // stay NULL (the external / legacy path).
  await sql`
    UPDATE presentation_versions v
    SET created_by_user_id = u.id
    FROM users u
    WHERE v.created_by_user_id IS NULL
      AND lower(v.created_by) = lower(u.email)
  `.execute(db);

  // No index: created_by_user_id is an audit stamp, never a read key (the
  // version list is already scoped by presentation_id). Adding one before a
  // read needs it would be dead weight — same call migration 063 made for its
  // created_by_user_id / updated_by_user_id columns.
};

export const down = async (db) => {
  await sql`
    ALTER TABLE presentation_versions DROP COLUMN IF EXISTS created_by_user_id
  `.execute(db);
};
