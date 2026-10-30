/**
 * Revoking a publication edition (T1.4).
 *
 * An edition row is immutable (migration 103 refuses every UPDATE), so a
 * revocation cannot be a column on it: it is a row of its own, one per
 * edition, keyed by the edition. While that row exists every public surface
 * of the edition - canvas, reader, manifest, verification package and preview
 * image - answers with a content-free tombstone (410), and the edition's
 * bytes are no longer read for a reader. The bytes themselves stay: wiping
 * them is a separate, later decision (`docs/plans/briefs/publication-records.md`
 * § 5).
 *
 * `organization_id` repeats the edition's organization so a revocation is
 * written and read under a storage scope like every other row. The actor is
 * internal and nullable for the same reason as the publish audit: a user can
 * be deleted, a revocation should not be.
 *
 * Both directions are idempotent. `down` drops the table, which makes every
 * revoked edition public again; it exists for a development rollback only.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS publication_edition_revocations (
      edition_id UUID PRIMARY KEY REFERENCES publication_editions(id) ON DELETE CASCADE,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP TABLE IF EXISTS publication_edition_revocations`.execute(db);
};
