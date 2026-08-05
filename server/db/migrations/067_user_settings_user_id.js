/**
 * Migration: give `user_settings` a stable identity beside its e-mail primary
 * key — the settings half of the identity-decoupling epic (T10, PR E; see
 * docs/plans/briefs/identity-decoupling.md § Restwerk).
 *
 * `user_settings` was created e-mail-keyed **on purpose**: migration 059's
 * decision point 5 chose "the user's e-mail in its OWN column (not a composite
 * string)" precisely so this re-key would be one UPDATE per row rather than a
 * table rewrite. This is that UPDATE. It is the sibling of migrations 062
 * (collaborators) and 063 (presentations), with one structural difference
 * noted below.
 *
 * ## Why the index is UNIQUE here and not in 062/063
 *
 * A deck has many collaborators and an owner owns many decks, so `user_id`
 * there is a non-unique lookup column. Settings are one row per person: the
 * table's whole point is that `email` is a primary key. Once `user_id` becomes
 * a read *and upsert* key, two rows carrying the same `user_id` would make
 * "read this person's settings" ambiguous and let a write silently update the
 * wrong one. So the index is UNIQUE — partial on the non-NULL rows, because
 * NULL `user_id` is the normal external/legacy state and many rows may share
 * it (PostgreSQL would allow repeated NULLs in a plain unique index anyway;
 * the partial predicate keeps the index off those rows entirely).
 *
 * ## Why nullable, and why `ON DELETE SET NULL`
 *
 * Same reasoning as 062/063. A `user_settings.email` can name someone who is
 * not a `users` row on this instance — the shared `anonymous` bucket the
 * facade writes for a caller with no e-mail, a legacy row imported off disk by
 * 059, an account provisioned outside this instance. Those rows keep
 * `user_id` NULL forever and must keep working; that is the "external" state
 * the resolver names (server/storage/identity-resolver.js). So no NOT NULL.
 *
 * `ON DELETE SET NULL`, not CASCADE: deleting a `users` row must not silently
 * delete that person's stored preferences. Dropping the id link falls the row
 * back to the e-mail key the reads still tolerate, which is the same
 * behaviour-preserving choice 063 made for decks.
 *
 * ## The backfill is idempotent
 *
 * Each existing row maps to `users.id` by its e-mail (case-insensitively; the
 * column is normalized on write, the `lower()` is belt-and-braces). The
 * `WHERE user_id IS NULL` guard makes a re-run a no-op, and an e-mail with no
 * `users` row is left NULL — the external/legacy path, unchanged.
 *
 * A `users` table with two rows differing only in e-mail case would make the
 * join ambiguous; `users.email` is normalized on write and 063 already relies
 * on the same assumption, so this adds no new one.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Nullable FK to the stable user identity. IF NOT EXISTS keeps the migration
  // re-run safe, matching 062/063.
  await sql`
    ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS user_id uuid
      REFERENCES users(id) ON DELETE SET NULL
  `.execute(db);

  // Backfill via the users table. Guarded on user_id IS NULL so a second run
  // touches nothing; rows whose e-mail has no user row stay NULL.
  await sql`
    UPDATE user_settings s
    SET user_id = u.id
    FROM users u
    WHERE s.user_id IS NULL
      AND lower(s.email) = lower(u.email)
  `.execute(db);

  // UNIQUE, unlike 062/063: settings are one row per person, and this column is
  // now both a read key and an upsert conflict target. Partial on the non-NULL
  // rows — the external/legacy rows stay out of the index.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_id
    ON user_settings(user_id)
    WHERE user_id IS NOT NULL
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_user_settings_user_id`.execute(db);
  await sql`ALTER TABLE user_settings DROP COLUMN IF EXISTS user_id`.execute(db);
};
