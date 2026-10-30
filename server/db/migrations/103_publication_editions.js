/**
 * Publication series, immutable editions and their deliveries (T1.3).
 *
 * Three records, three responsibilities (`docs/reference/publication-editions.md`):
 *
 *  - `publications` - the series: a random public UUID, the organization
 *    that manages it, and an optional reference to the source deck. The
 *    reference is `ON DELETE SET NULL`: deleting the deck leaves the series
 *    and every edition in it untouched. `last_version` is the counter a
 *    publish increments under the row lock, so two concurrent publishes of
 *    one deck get two numbers, never one.
 *  - `publication_editions` - append-only. `(publication_id, version)` is
 *    unique, and a trigger refuses every UPDATE: an edition's bytes, hashes
 *    and number are never rewritten, not by a deck edit, a version prune or
 *    a migration. The frozen input and manifest bytes from T1.2 are stored
 *    as received. `(organization_id, idempotency_key)` is unique, so a retry
 *    finds the edition its first attempt made.
 *  - `publication_deliveries` - `(edition_id, destination)`, with a status
 *    and a receipt. Only `local` exists; a later destination adds a row,
 *    never a second edition.
 *
 * Beside them: `publication_edition_assets` (the closed asset set of an
 * edition, from its manifest; the bytes themselves are inline in the input),
 * `publication_edition_audit` (who published, internal: a user row may be
 * deleted, an edition may not be updated, so the actor lives in its own
 * table) and `publication_staging` (prepared bytes waiting for their commit,
 * never public, swept by the retention job once abandoned).
 *
 * `down` drops all six and the trigger function. Both directions are
 * idempotent. No data migration: existing `published_presentations` rows
 * stay as they are until T1.5 converts them.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS publications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      presentation_id UUID REFERENCES presentations(id) ON DELETE SET NULL,
      last_version INTEGER NOT NULL DEFAULT 0 CHECK (last_version >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, presentation_id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS publication_editions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      publication_id UUID NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version > 0),
      source_revision INTEGER NOT NULL,
      renderer_hash TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      manifest_bytes BYTEA NOT NULL,
      input_bytes BYTEA NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (publication_id, version),
      UNIQUE (organization_id, idempotency_key)
    )
  `.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION publication_editions_immutable()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'publication editions are immutable'
        USING ERRCODE = 'restrict_violation';
    END
    $$
  `.execute(db);
  await sql`
    DROP TRIGGER IF EXISTS publication_editions_no_update ON publication_editions
  `.execute(db);
  await sql`
    CREATE TRIGGER publication_editions_no_update
    BEFORE UPDATE ON publication_editions
    FOR EACH ROW EXECUTE FUNCTION publication_editions_immutable()
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS publication_edition_assets (
      edition_id UUID NOT NULL REFERENCES publication_editions(id) ON DELETE CASCADE,
      sha256 TEXT NOT NULL,
      media_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      PRIMARY KEY (edition_id, sha256, media_type)
    )
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_publication_edition_assets_sha256
    ON publication_edition_assets (sha256)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS publication_edition_audit (
      edition_id UUID PRIMARY KEY REFERENCES publication_editions(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS publication_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      edition_id UUID NOT NULL REFERENCES publication_editions(id) ON DELETE CASCADE,
      destination TEXT NOT NULL CHECK (destination IN ('local')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
      receipt JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (edition_id, destination)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS publication_staging (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
      input_bytes BYTEA NOT NULL,
      manifest_bytes BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_publication_staging_created
    ON publication_staging (created_at)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP TABLE IF EXISTS publication_staging`.execute(db);
  await sql`DROP TABLE IF EXISTS publication_deliveries`.execute(db);
  await sql`DROP TABLE IF EXISTS publication_edition_audit`.execute(db);
  await sql`DROP TABLE IF EXISTS publication_edition_assets`.execute(db);
  await sql`DROP TABLE IF EXISTS publication_editions`.execute(db);
  await sql`DROP FUNCTION IF EXISTS publication_editions_immutable()`.execute(
    db,
  );
  await sql`DROP TABLE IF EXISTS publications`.execute(db);
};
