/**
 * Migration: give the remaining raw-email authz columns a stable id beside
 * them — the trash and slide-library/collections half of the identity epic
 * (T10, PR F2; see docs/plans/briefs/identity-decoupling.md § Restwerk, "F2").
 *
 * PR A/C moved the deck authz *comparisons* onto `users.id`, but three column
 * families were still compared as bare lowercased e-mails because the rows had
 * no id half to key on:
 *
 *   - `presentations.trashed_by`  — the trash list and restore route check it.
 *   - `slide_library.created_by`  — the team-library trash/delete guard checks it.
 *   - `slide_collections.created_by` — the team-collection mutate guard checks it.
 *
 * This migration lays the id columns those comparisons will key on, on the exact
 * 062/063 template: nullable FK to `users(id)`, `ON DELETE SET NULL`, idempotent
 * backfill via the users table on the normalized e-mail, NULL for rows whose
 * e-mail never matched a user (the external/legacy path). It is deliberately
 * **behaviour-preserving** — F2's route changes are what start reading these,
 * and the dual-key stamp keeps them populated on write so the two halves cannot
 * drift (the invariant `verifyIdentityConsistency()` checks).
 *
 * `updated_by_user_id` rides along on both library tables so the `updated_by`
 * e-mail they already stamp gets the same id treatment — completing the dual key
 * rather than leaving one audit half email-only. All of these are audit/authz
 * columns read by an already-scoped list, not a lookup key, so — like migration
 * 063's `created_by_user_id`/`updated_by_user_id` — they get no index and no
 * unique constraint.
 *
 * Deliberately **not** here: `slide_library.trashed_by` gets no id column. No
 * comparison reads it (the library trash/delete guard keys on `created_by`), so
 * an id half would be dead weight — and the write path that stamps `trashed_by`
 * also stamps `updated_by_user_id` on the same row, so that write is not
 * identity-blind. `font_families`/`custom_slide_types` are also untouched: their
 * `created_by` already holds a `users.id` (no external writers), a deliberate
 * id-only shape documented in those modules.
 *
 * `ON DELETE SET NULL` (not CASCADE) for the same reason as 062/063: deleting a
 * `users` row must never delete a deck, a library item or a collection — losing
 * the id link just drops the row back to the e-mail path the reads tolerate.
 *
 * ## The `trashedById` snapshot strip
 *
 * Adding `trashed_by_user_id` makes `mapPresentationRow` surface `trashedById`,
 * so — like every other identity field a presentation carries — it joins
 * `SNAPSHOT_IDENTITY_FIELDS` and must be kept out of version snapshots. The
 * backfill-coverage gate (tests/snapshot-identity-backfill-coverage.test.js)
 * then requires a migration that erased it from the rows written before it, the
 * same contract migration 068 answered for the other seven fields. This
 * migration answers it for `trashedById` by declaring `STRIPPED_SNAPSHOT_FIELDS`
 * and running the same idempotent `-` strip. In practice it erases nothing —
 * `trashedById` never existed before this PR, so no old snapshot bag carries it
 * — but the strip is the honest form of the coverage promise (a `snapshotted`
 * deck is a live, untrashed deck, so `trashedById` is null there anyway). The
 * `IS DISTINCT FROM` guard makes the whole statement a true no-op on rows that
 * lack the key, as in 068.
 */

import { sql } from 'kysely';

/**
 * The snapshot key this migration erases from `presentation_data`.
 *
 * Frozen here as a literal (not imported from snapshot-identity.js), for the
 * same reason migration 068 froze its own list: a migration is a historical
 * record and may not silently grow a field. The backfill-coverage gate unions
 * this across every migration and requires it to cover `SNAPSHOT_IDENTITY_FIELDS`.
 *
 * @type {readonly string[]}
 */
export const STRIPPED_SNAPSHOT_FIELDS = Object.freeze(['trashedById']);

/**
 * Each id column this migration adds, paired with its e-mail source column and
 * the table it lives on.
 */
const COLUMNS = [
  { table: 'presentations', id: 'trashed_by_user_id', email: 'trashed_by' },
  { table: 'slide_library', id: 'created_by_user_id', email: 'created_by' },
  { table: 'slide_library', id: 'updated_by_user_id', email: 'updated_by' },
  { table: 'slide_collections', id: 'created_by_user_id', email: 'created_by' },
  { table: 'slide_collections', id: 'updated_by_user_id', email: 'updated_by' },
];

export const up = async (db) => {
  for (const { table, id, email } of COLUMNS) {
    // Nullable FK to the stable user identity. IF NOT EXISTS keeps the whole
    // migration idempotent (re-run safe), matching migrations 062/063.
    await sql`
      ALTER TABLE ${sql.table(table)}
      ADD COLUMN IF NOT EXISTS ${sql.ref(id)} uuid
        REFERENCES users(id) ON DELETE SET NULL
    `.execute(db);

    // Backfill existing rows via the users table. Guarded on <id_col> IS NULL
    // so a second run touches nothing; rows whose e-mail has no user row stay
    // NULL (the external / legacy path).
    await sql`
      UPDATE ${sql.table(table)} r
      SET ${sql.ref(id)} = u.id
      FROM users u
      WHERE r.${sql.ref(id)} IS NULL
        AND lower(r.${sql.ref(email)}) = lower(u.email)
    `.execute(db);
  }

  // Keep `trashedById` out of the version snapshots (see the docblock). The
  // `IS DISTINCT FROM` guard makes this a no-op on rows without the key, so it
  // burns no dead tuples — the same shape as migration 068.
  await sql`
    UPDATE presentation_versions
    SET presentation_data = presentation_data - 'trashedById'
    WHERE presentation_data - 'trashedById' IS DISTINCT FROM presentation_data
  `.execute(db);
};

export const down = async (db) => {
  for (const { table, id } of COLUMNS) {
    await sql`
      ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS ${sql.ref(id)}
    `.execute(db);
  }
};
