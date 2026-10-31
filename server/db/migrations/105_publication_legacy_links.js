/**
 * Old publication links point at their first edition (T1.5, D360, D361).
 *
 * Before editions, a deck was published at `/p/{publishId}-{slug}`: an
 * eight-hex id in `published_presentations` that showed whatever the deck
 * said at the moment of the visit. The one-off conversion
 * (`scripts/migrate-publications-to-editions.js`) seals each such deck once
 * as an edition and records here which edition every old id stands for. The
 * old address then resolves to exactly that edition, never to a later one: a
 * link that was cited keeps showing what it showed on the day of the
 * conversion.
 *
 * `legacy_id` is the old publish id and the key; one deck may have had more
 * than one, and they all point at the same edition. `organization_id` repeats
 * the edition's organization so the row is written under a storage scope.
 *
 * The deck's own `published` column goes. It was a copy of the index entry
 * that could drift from it (on slides.ciiic.nl ten of twenty-two entries had
 * no copy left), and the deck's publication state is now read from its
 * editions. `published_presentations` stays until the conversion has run on
 * every installation; a later migration drops it.
 *
 * The deck setting `ogPreview` goes with it: it chose whether the generated
 * preview image showed the author, and an edition's preview is the first image
 * it shows, from its own bytes, so nothing reads it any more.
 *
 * `up` is idempotent. `down` recreates the column empty and drops the links:
 * a development rollback, not a way back for converted data.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS publication_legacy_links (
      legacy_id TEXT PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      edition_id UUID NOT NULL REFERENCES publication_editions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_publication_legacy_links_edition
    ON publication_legacy_links (edition_id)
  `.execute(db);
  await sql`ALTER TABLE presentations DROP COLUMN IF EXISTS published`.execute(
    db,
  );
  await sql`
    UPDATE presentations SET settings = settings - 'ogPreview'
    WHERE settings ? 'ogPreview'
  `.execute(db);
};

export const down = async (db) => {
  await sql`
    ALTER TABLE presentations ADD COLUMN IF NOT EXISTS published JSONB
  `.execute(db);
  await sql`DROP TABLE IF EXISTS publication_legacy_links`.execute(db);
};
