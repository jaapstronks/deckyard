/**
 * Migration: make the three session-scoped interaction tables from
 * `001_initial_schema.js` usable, so questions, polls/likerts and feedback can
 * move off disk.
 *
 * `questions`, `interactions` (+ `interaction_votes`) and `feedback` were
 * created in 001 and never written to: `storage/questions.js`,
 * `storage/interactions.js` and `storage/feedback.js` each wrote one JSON file
 * per session under `dataDir()`, regardless of `STORAGE_MODE`. Waking the
 * dormant schema means first correcting where it disagrees with the code about
 * to use it (decision 1 of `docs/plans/briefs/disk-json-to-postgres.md`):
 *
 *  - `organization_id` is dropped from all three. Nothing scopes these domains
 *    by organization: a question, a vote and a feedback entry belong to a live
 *    session, which belongs to a deck, which belongs to an organization. The
 *    session foreign key already carries that chain, and deleting an
 *    organization still cascades through `presentations` → `present_sessions`.
 *    Same reasoning as migration 060 applied to the same dead column.
 *  - `session_id` becomes `NOT NULL` in all three. A row with no session is not
 *    a row any reader can use — every lookup is by session — and the column was
 *    nullable only because 001 declared the foreign key without the constraint.
 *  - `questions.upvotes` is dropped. `voters` is the set of device ids that
 *    voted, so the count is `cardinality(voters)`; a stored integer beside it is
 *    a second copy that can drift. The interactions module already treats its
 *    per-device map as the single source of truth and computes totals from it
 *    (`computeTotalsFromVotes`); this brings questions in line.
 *  - `questions.original_text` is dropped. The file format stored the asked text
 *    twice — `text` and `original_text` were assigned the same value on create
 *    and neither was ever rewritten, because questions are not translated. One
 *    column, `text`, is the text as asked; `original_lang` says what language it
 *    was asked in and `texts` still holds the per-language map for the day
 *    translation lands.
 *  - `questions.voters` becomes `NOT NULL DEFAULT '{}'`. `cardinality(NULL)` is
 *    NULL, so a null array would make the derived upvote count null rather than
 *    zero.
 *  - `interactions.type` starts carrying a third value, `'feedback'`. The column
 *    needs no change for it (no check constraint, `varchar(20)`), but the reason
 *    it is legal is worth stating — see below.
 *
 * ## Why feedback's per-slide lifecycle lives in `interactions`
 *
 * The `feedback` table 001 created holds entries (session, slide, device, text)
 * and has nowhere to put the per-slide open/closed status the presenter
 * controls. That status is the same concept `interactions.status` already
 * models: `liveInteractionKind()` returns `'poll' | 'likert' | 'feedback'` from
 * one list, and the presenter route opens, closes and resets all three through
 * one code path. So a feedback slide gets an `interactions` row like any other
 * live interaction (type `'feedback'`, no options), and `feedback` stays what
 * its columns say it is: the answers, the free-text sibling of
 * `interaction_votes`. Adding a second per-slide lifecycle table for the same
 * concept is exactly the drift this track exists to remove.
 *
 * No import: all three are 24h-TTL ephemera bound to a live session (decision
 * 4), so whatever sits in `questions/`, `interactions/` or `feedback/` on an
 * upgrading install expires on its own. Collection is the `ON DELETE CASCADE`
 * from `present_sessions`, which the sweep in `utils/live-session-cleanup.js`
 * now drives for these domains too.
 */

import { sql } from 'kysely';

/** Tables whose dead `organization_id` column this migration removes. */
const ORG_SCOPED_TABLES = ['questions', 'interactions', 'feedback'];

export const up = async (db) => {
  for (const table of ORG_SCOPED_TABLES) {
    await sql`ALTER TABLE ${sql.ref(table)} DROP COLUMN IF EXISTS organization_id`.execute(db);

    // Nothing ever wrote these tables, so there are no sessionless rows to
    // preserve — but a DELETE first keeps the NOT NULL from failing on an
    // install where something did.
    await sql`DELETE FROM ${sql.ref(table)} WHERE session_id IS NULL`.execute(db);
    await sql`
      ALTER TABLE ${sql.ref(table)} ALTER COLUMN session_id SET NOT NULL
    `.execute(db);
  }

  // --- questions ----------------------------------------------------------
  await sql`ALTER TABLE questions DROP COLUMN IF EXISTS upvotes`.execute(db);
  await sql`ALTER TABLE questions DROP COLUMN IF EXISTS original_text`.execute(db);

  await sql`UPDATE questions SET voters = '{}' WHERE voters IS NULL`.execute(db);
  await sql`
    ALTER TABLE questions
    ALTER COLUMN voters SET DEFAULT '{}',
    ALTER COLUMN voters SET NOT NULL
  `.execute(db);

  // Every read is "the questions of this session", ranked. The 001 schema had
  // no index for it, so each list would have been a sequential scan.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_questions_session
    ON questions (session_id)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_questions_session`.execute(db);

  await sql`
    ALTER TABLE questions
    ALTER COLUMN voters DROP NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE questions ADD COLUMN IF NOT EXISTS original_text TEXT
  `.execute(db);
  // The pre-061 shape kept the asked text in both columns.
  await sql`UPDATE questions SET original_text = text`.execute(db);

  await sql`
    ALTER TABLE questions ADD COLUMN IF NOT EXISTS upvotes INTEGER DEFAULT 0
  `.execute(db);
  await sql`UPDATE questions SET upvotes = cardinality(voters)`.execute(db);

  for (const table of ORG_SCOPED_TABLES) {
    await sql`
      ALTER TABLE ${sql.ref(table)} ALTER COLUMN session_id DROP NOT NULL
    `.execute(db);
    await sql`
      ALTER TABLE ${sql.ref(table)}
      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE
    `.execute(db);
  }
};
