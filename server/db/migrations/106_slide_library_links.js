/**
 * Which decks hold a copy of which library item (B904, D223).
 *
 * A slide inserted from the library carries `libraryRef: { itemId, revision }`
 * in the deck JSON. When the item's maker saves a new revision, the server has
 * to find the decks with a linked copy; searching every deck's JSON on each
 * item save does not scale, so every deck write keeps this table in step with
 * the refs it stores: one row per linked slide, replaced as a set per deck
 * (`server/storage/slide-library-links.js`).
 *
 * The rows are derived, never authored: the deck JSON is the truth, and a
 * deck write rebuilds its rows from it. `revision` and `ignored_revision`
 * repeat the ref so the item save can skip decks that are already current or
 * chose to ignore that revision without reading the deck.
 *
 * `item_id` has no foreign key on purpose: a trashed or deleted item leaves
 * its copies standing (brief § 8), and the next deck write must not fail on a
 * ref to an item that is gone. Deleting the deck removes its rows.
 *
 * No backfill (brief § 12): existing copies never recorded where they came
 * from, so only slides inserted after this release are linked.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS slide_library_links (
      presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
      slide_id TEXT NOT NULL,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      item_id UUID NOT NULL,
      revision INTEGER NOT NULL,
      ignored_revision INTEGER,
      PRIMARY KEY (presentation_id, slide_id)
    )
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_library_links_item
      ON slide_library_links (organization_id, item_id)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP TABLE IF EXISTS slide_library_links`.execute(db);
};
