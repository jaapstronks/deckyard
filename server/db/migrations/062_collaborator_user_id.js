/**
 * Migration: give `presentation_collaborators` a stable `user_id` beside its
 * `user_email` — the dual-key step of the identity-decoupling epic (T10, PR 2;
 * see docs/plans/briefs/identity-decoupling.md, scope-item 2).
 *
 * Today every ACL row keys on an **email string** (`user_email`). The epic
 * rebuilds the ownership/ACL layer onto the stable `users.id` UUID, and this
 * migration lays the column that rebuild will read. It is deliberately
 * **behaviour-preserving**: nothing reads `user_id` yet. `user_email` stays the
 * leading key — its unique constraint (`unique_collaborator`, migration 010) is
 * untouched, every read still keys on the email, and who can access what does
 * not change. A later PR moves the reads over; this one only makes the target
 * exist and keeps it populated on write (`server/storage/collaborators.js`).
 *
 * ## Why nullable, and why `ON DELETE SET NULL`
 *
 * `user_id` is **nullable on purpose**: an external collaborator — invited by
 * email, never a `users` row on this instance — is a first-class, pinned path
 * (PR 1, tests/pg/collaborator-authz-resolution.pgtest.js). Those rows keep
 * `user_id NULL` forever and must keep working; that is exactly the "external"
 * state the resolver names (`server/storage/identity-resolver.js`). So no
 * NOT NULL, and no unique on `user_id`: the leading identity is still the email,
 * and two email aliases of one person, or many external NULLs, must not collide.
 *
 * `ON DELETE SET NULL` (not CASCADE): deleting a `users` row must not silently
 * revoke an ACL grant. The grant was made against an email and still holds
 * against that email; losing the `user_id` link just drops it back to the
 * external/legacy path the reads already tolerate. CASCADE would delete the
 * collaborator row and quietly change who has access — the opposite of
 * behaviour-preserving.
 *
 * ## The backfill is idempotent
 *
 * Existing rows are mapped to `users.id` by email (case-insensitively; both
 * columns are normalized on write, the `lower()` is belt-and-braces). The
 * `WHERE user_id IS NULL` guard makes a re-run a no-op, and emails with no
 * `users` row are simply left NULL — the external-collaborator path, unchanged.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Nullable FK to the stable user identity. IF NOT EXISTS keeps the whole
  // migration idempotent (re-run safe), matching migration 061's column adds.
  await sql`
    ALTER TABLE presentation_collaborators
    ADD COLUMN IF NOT EXISTS user_id uuid
      REFERENCES users(id) ON DELETE SET NULL
  `.execute(db);

  // Backfill existing rows via the users table. Guarded on user_id IS NULL so a
  // second run touches nothing; rows whose email has no user row stay NULL (the
  // external-collaborator / legacy / file-mode path PR 1 pinned).
  await sql`
    UPDATE presentation_collaborators c
    SET user_id = u.id
    FROM users u
    WHERE c.user_id IS NULL
      AND lower(c.user_email) = lower(u.email)
  `.execute(db);

  // A non-unique index for the reads a later PR will key on user_id. Partial on
  // active rows, mirroring idx_collaborators_user (migration 010). NOT unique:
  // user_id is nullable and non-leading, so uniqueness stays on the email.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_collaborators_user_id
    ON presentation_collaborators(user_id, organization_id)
    WHERE revoked_at IS NULL AND user_id IS NOT NULL
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_collaborators_user_id`.execute(db);
  await sql`
    ALTER TABLE presentation_collaborators DROP COLUMN IF EXISTS user_id
  `.execute(db);
};
