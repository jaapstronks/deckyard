import { sql } from 'kysely';

/**
 * Per-deck notification subscriptions (phase 4 of the comments &
 * notifications plan) — the GitHub "participating vs watching" model.
 *
 * A row is an explicit per-deck override of the user's default level:
 *   watching       - all comment activity on the deck
 *   participating  - own decks, threads you wrote in, replies to you
 *   mentions_only  - only direct @mentions
 *   mute           - only direct @mentions (mentions always reach you);
 *                    intent differs from mentions_only: mute silences a
 *                    busy deck, mentions_only is a lean default
 * No row = the user's global default (settings), which defaults to
 * participating.
 */

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS presentation_subscriptions (
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
      user_email VARCHAR(320) NOT NULL,
      level VARCHAR(20) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (presentation_id, user_email)
    )
  `.execute(db);
};

export const down = async (db) => {
  await db.schema.dropTable('presentation_subscriptions').ifExists().execute();
};
