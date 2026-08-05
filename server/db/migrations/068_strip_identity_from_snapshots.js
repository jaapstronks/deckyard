/**
 * Migration: erase the identity fields from the version snapshots written
 * before PR D — the backfill half of the identity-decoupling epic
 * (T10, PR G; see docs/plans/briefs/identity-decoupling.md § Restwerk).
 *
 * PR D (#644) stopped *writing* identity into `presentation_versions.
 * presentation_data`: `stripIdentityForSnapshot()` removes the fields on the
 * way in, and nothing reads them back out — restore consumes `title`,
 * `description`, `settings`, `i18n`, `slides` and `published` only, and takes
 * ownership from the living deck (server/storage/presentations/snapshot-identity.js
 * documents the full argument, tests/pg/version-snapshot-identity.pgtest.js
 * pins it). What that PR could not do was reach the rows already on disk.
 *
 * Every snapshot taken before #644 still stamps its deck's owner e-mail into a
 * table nothing ever erases from, and still names the *previous* owner after a
 * transfer. This is the one-time UPDATE that clears them.
 *
 * ## Why this is safe to run without a code change alongside it
 *
 * Because the read side is already gone. A row that loses `ownerEmail` here
 * loses a key no code path looks up — that is exactly what #644 established and
 * pinned, and it is the precondition this migration waited for. The slides,
 * settings and i18n a restore actually consumes are untouched.
 *
 * ## Idempotence
 *
 * The `-` chain is itself idempotent (removing an absent key is a no-op), but
 * an unguarded UPDATE would still rewrite every row and burn a dead tuple per
 * snapshot on each run. The `IS DISTINCT FROM` guard makes a second run touch
 * literally nothing — it is also the most honest form of the predicate, since
 * it asks precisely "would this change anything?" rather than restating the
 * field list a second time in another dialect (`?|`).
 *
 * ## Why the field list is inlined and not imported
 *
 * A migration is a historical record: it must keep doing in a year what it did
 * the day it ran, which a shared constant that later grows a field cannot
 * promise. So the list is frozen here as a literal. The other half of that
 * bargain — that a *new* identity field cannot be added to
 * `SNAPSHOT_IDENTITY_FIELDS` without a backfill for it — is held by
 * `tests/snapshot-identity-backfill-coverage.test.js`, which unions the
 * `STRIPPED_SNAPSHOT_FIELDS` exported by every migration in this folder and
 * requires the union to cover the constant. Adding a field means adding a
 * migration; the gate says so out loud.
 *
 * ## No `down`
 *
 * The removed values are not recoverable and were never a source of truth.
 * `down` is a documented no-op rather than a lie about reversibility, matching
 * the data migrations (030, 056) that likewise transform rather than reshape.
 */

import { sql } from 'kysely';

/**
 * The identity keys this migration removes from `presentation_data`.
 *
 * Frozen as of migration 068, mirroring `SNAPSHOT_IDENTITY_FIELDS` in
 * server/storage/presentations/snapshot-identity.js at that time. Exported so
 * the coverage gate can see it; not imported *from* there, for the reason in
 * the module docblock above.
 *
 * @type {readonly string[]}
 */
export const STRIPPED_SNAPSHOT_FIELDS = Object.freeze([
  'ownerId',
  'ownerEmail',
  'createdById',
  'createdBy',
  'updatedById',
  'updatedBy',
  'trashedBy',
]);

export const up = async (db) => {
  await sql`
    UPDATE presentation_versions
    SET presentation_data =
      presentation_data
        - 'ownerId'
        - 'ownerEmail'
        - 'createdById'
        - 'createdBy'
        - 'updatedById'
        - 'updatedBy'
        - 'trashedBy'
    WHERE presentation_data
        - 'ownerId'
        - 'ownerEmail'
        - 'createdById'
        - 'createdBy'
        - 'updatedById'
        - 'updatedBy'
        - 'trashedBy'
      IS DISTINCT FROM presentation_data
  `.execute(db);
};

export const down = async () => {
  // Deliberately empty: the stripped values are gone and were never a source
  // of truth. See the module docblock.
};
