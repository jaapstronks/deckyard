/**
 * The comment thread on a shared library item (B906, D369).
 *
 * Someone who uses a colleague's library slide and sees a mistake in it cannot
 * fix the original (D170: only the maker or an admin changes it), and a copy
 * of their own leaves every other deck wrong. This table is the way back to
 * the maker: one thread per organization-shelf item, read by whoever may read
 * the item, and every message notifies the maker.
 *
 * It is a table of its own, not a target column on `presentation_comments`.
 * A deck comment is anchored (slide, position, snapshot), carries a status,
 * can be written by a share-link guest and is read through the deck's
 * collaborator rules; every read and write path of that table authorizes
 * against `presentation_id`. A library thread has none of that: one flat
 * thread, signed-in members only, authorized by the item. Sharing the table
 * would put a second read boundary into each of those paths.
 *
 * The author follows migration 079: `author_user_id` is the key (nullable FK,
 * `ON DELETE SET NULL`, so deleting a person forgets who wrote a message but
 * keeps it), `author_email` is the address the notification path addresses
 * and never crosses the API boundary. Deleting the item deletes its thread.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS slide_library_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      item_id UUID NOT NULL REFERENCES slide_library(id) ON DELETE CASCADE,
      author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      author_email VARCHAR(320) NOT NULL,
      author_name VARCHAR(255),
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_library_comments_item
      ON slide_library_comments (organization_id, item_id, created_at)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP TABLE IF EXISTS slide_library_comments`.execute(db);
};
