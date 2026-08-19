/**
 * Migration: give a comment's author a stable id — the comments half of D22
 * (A1 deel 2, PR C; see `docs/reference/identity-in-responses.md`).
 *
 * A comment row named its author by address alone (`author_email`,
 * `author_name`), and both the client and the server compared that address to
 * decide whether the edit/delete affordance shows and whether the write is
 * allowed. That is the last place an address was still a key, and it is why a
 * comment payload had to carry one. This migration lays the two columns those
 * comparisons move onto:
 *
 *   - `author_user_id` — the commenter's `users.id`, for a signed-in author. The
 *     same nullable-FK / `ON DELETE SET NULL` template as migrations 062/063/070:
 *     deleting a person must not delete their comments, it must only forget who
 *     wrote them.
 *   - `author_guest_id` — the `share_link_guests.id` of a share-link guest, who
 *     has no `users` row at all and never will. A guest is a real, identifiable
 *     author (they verified an address against a link the deck owner issued);
 *     their identity is that guest row, and the id of it is the key.
 *
 * Exactly one of the two is set on a comment written from here on. Both stay
 * NULL for a legacy row whose address matched neither — an unattributed comment
 * that nobody can claim, which is the same defined absence
 * `shared/identity-match.js` names for every other stamp.
 *
 * ## Both columns are backfilled, and indexed
 *
 * Unlike the lock tables (071), comment rows are permanent: a comment written
 * before this migration must keep its author's rights, so both halves are
 * backfilled from the address they were written under. The guest backfill is
 * scoped to the *same presentation* the guest was invited to, because a guest
 * identity is per share link — matching on the address alone across decks would
 * hand one guest another guest's comments.
 *
 * Both get an index: `author_user_id` because "my comments" and the author
 * filter select on it, `author_guest_id` because the guest edit check does.
 *
 * ## `author_email` stays
 *
 * The column is not dropped. It is what a future identity source (an SSO
 * subject, an atproto DID) would still resolve from, it is what the mention and
 * notification paths address, and dropping a NOT NULL column that every row
 * carries is a separate, irreversible decision from "stop comparing it". What
 * changes here is that nothing *compares* it any more, and that it stops
 * crossing the API boundary — enforced by `tests/response-identity-shape.test.js`.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    ALTER TABLE presentation_comments
    ADD COLUMN IF NOT EXISTS author_user_id uuid
      REFERENCES users(id) ON DELETE SET NULL
  `.execute(db);

  await sql`
    ALTER TABLE presentation_comments
    ADD COLUMN IF NOT EXISTS author_guest_id uuid
      REFERENCES share_link_guests(id) ON DELETE SET NULL
  `.execute(db);

  // Backfill the signed-in authors. Guarded on IS NULL so a second run touches
  // nothing; an address with no `users` row stays NULL (external/legacy).
  await sql`
    UPDATE presentation_comments c
    SET author_user_id = u.id
    FROM users u
    WHERE c.author_user_id IS NULL
      AND lower(c.author_email) = lower(u.email)
  `.execute(db);

  // Backfill the guests, per presentation: a guest identity belongs to the
  // share link it verified against, so the join goes through that link's deck.
  await sql`
    UPDATE presentation_comments c
    SET author_guest_id = g.id
    FROM share_link_guests g
    JOIN presentation_share_links l ON l.id = g.share_link_id
    WHERE c.author_guest_id IS NULL
      AND c.author_user_id IS NULL
      AND l.presentation_id = c.presentation_id
      AND lower(c.author_email) = lower(g.email)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_comments_author_user
      ON presentation_comments(author_user_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_comments_author_guest
      ON presentation_comments(author_guest_id)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_comments_author_guest`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_comments_author_user`.execute(db);
  await sql`
    ALTER TABLE presentation_comments DROP COLUMN IF EXISTS author_guest_id
  `.execute(db);
  await sql`
    ALTER TABLE presentation_comments DROP COLUMN IF EXISTS author_user_id
  `.execute(db);
};
