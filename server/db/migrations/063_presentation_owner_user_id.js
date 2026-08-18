/**
 * Migration: give `presentations` a stable identity beside its three email
 * columns — the ownership dual-key step of the identity-decoupling epic
 * (T10, PR 3; see docs/plans/briefs/identity-decoupling.md, scope-item 3).
 *
 * Today ownership and every authz decision key on **email strings**:
 * `owner_email`, `created_by`, `updated_by`. The epic rebuilds that layer onto
 * the stable `users.id` UUID, and this migration lays the three columns that
 * rebuild will read. It is the exact sibling of migration 062, which did the
 * same for `presentation_collaborators.user_id`, and it is deliberately
 * **behaviour-preserving**: nothing reads the new columns yet, every read still
 * keys on the email, and who owns or can touch what does not change. A later PR
 * moves the reads over; this one only makes the target exist and keeps it
 * populated on write (server/storage/presentations/index.js).
 *
 * ## The three id columns mirror the three email columns
 *
 *   - `owner_user_id`      ← `owner_email`   (the deck's owner)
 *   - `created_by_user_id` ← `created_by`    (who minted it)
 *   - `updated_by_user_id` ← `updated_by`    (who last wrote it)
 *
 * Each write site that stamps an email column must stamp the paired id column
 * **in the same statement**, or the two keys drift and the per-row verification
 * the data migration (brief volgorde-punt 4) depends on becomes impossible. In
 * PR 3 the create path stamps all three (all three emails are the owner at
 * create) and the update path stamps `updated_by_user_id` from the same actor
 * it writes to `updated_by`. The owner never changes on the PG update path
 * today (see the transfer-gap note in the brief, § PR 3), so `owner_user_id`
 * only ever moves at create — exactly like `owner_email`.
 *
 * ## Why nullable, and why `ON DELETE SET NULL`
 *
 * Same reasoning as 062. `owner_email`/`created_by`/`updated_by` can name a
 * person who is not a `users` row on this instance — a legacy deck, an owner
 * whose account was never provisioned, or (in the general case) an external
 * identity. Those rows keep their id column NULL forever and must keep working;
 * that is the "external" state the resolver names
 * (server/storage/identity-resolver.js). So no NOT NULL, and no unique: the
 * leading identity is still the email.
 *
 * `ON DELETE SET NULL` (not CASCADE): deleting a `users` row must never delete
 * a deck or silently rewrite its ownership. Losing the id link just drops the
 * row back to the email/legacy path the reads already tolerate; CASCADE would
 * delete the presentation and destroy data — the opposite of
 * behaviour-preserving.
 *
 * ## The backfill is idempotent
 *
 * Each existing row is mapped to `users.id` by its email (case-insensitively;
 * the columns are normalized on write, the `lower()` is belt-and-braces). The
 * `WHERE <id_col> IS NULL` guard makes a re-run a no-op, and emails with no
 * `users` row are simply left NULL — the external/legacy path, unchanged.
 *
 * ## One partial index, on the column the reads will key on
 *
 * Only `owner_user_id` gets an index: it is the column a later PR's ownership
 * authz reads will look decks up by, the id analog of `idx_presentations_owner`
 * (`owner_email`, migration 002). Partial on `owner_user_id IS NOT NULL` so the
 * many NULL legacy/external rows stay out of it, mirroring 062's partial index.
 * `created_by_user_id`/`updated_by_user_id` are audit stamps, not read keys, so
 * they get no index — adding one before a read needs it would be dead weight.
 */

import { sql } from 'kysely';

/** The three id columns this migration adds, paired with their email source. */
const COLUMNS = [
  { id: 'owner_user_id', email: 'owner_email' },
  { id: 'created_by_user_id', email: 'created_by' },
  { id: 'updated_by_user_id', email: 'updated_by' },
];

export const up = async (db) => {
  for (const { id, email } of COLUMNS) {
    // Nullable FK to the stable user identity. IF NOT EXISTS keeps the whole
    // migration idempotent (re-run safe), matching migration 062's column add.
    await sql`
      ALTER TABLE presentations
      ADD COLUMN IF NOT EXISTS ${sql.ref(id)} uuid
        REFERENCES users(id) ON DELETE SET NULL
    `.execute(db);

    // Backfill existing rows via the users table. Guarded on <id_col> IS NULL
    // so a second run touches nothing; rows whose email has no user row stay
    // NULL (the external / legacy path PR 1 pinned).
    await sql`
      UPDATE presentations p
      SET ${sql.ref(id)} = u.id
      FROM users u
      WHERE p.${sql.ref(id)} IS NULL
        AND lower(p.${sql.ref(email)}) = lower(u.email)
    `.execute(db);
  }

  // A non-unique, partial index for the ownership reads a later PR will key on
  // owner_user_id — the id analog of idx_presentations_owner (owner_email,
  // migration 002). Partial on the non-NULL rows, mirroring migration 062's
  // idx_collaborators_user_id. Composite with organization_id because those
  // reads are org-scoped.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_presentations_owner_user_id
    ON presentations(owner_user_id, organization_id)
    WHERE owner_user_id IS NOT NULL
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_presentations_owner_user_id`.execute(db);
  for (const { id } of COLUMNS) {
    await sql`
      ALTER TABLE presentations DROP COLUMN IF EXISTS ${sql.ref(id)}
    `.execute(db);
  }
};
