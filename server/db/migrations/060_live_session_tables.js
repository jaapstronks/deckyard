/**
 * Migration: make the two live-session tables from `001_initial_schema.js`
 * usable, so follow codes and present sessions can move off disk.
 *
 * Both tables were created in 001 and then never written to: `follow-codes.js`
 * wrote `follow-codes.json` and `present-sessions/disk.js` wrote one JSON file
 * per session, regardless of `STORAGE_MODE`. Waking the dormant schema means
 * first correcting where it disagrees with the code that is about to use it
 * (decision 1 of `docs/plans/briefs/disk-json-to-postgres.md`):
 *
 *  - `follow_codes.code` was `char(4)`; codes have been five characters since
 *    the M3 security fix widened the keyspace, so every insert would have
 *    failed. Widened to `text` — the length is a property of the generator
 *    (`CODE_LENGTH` in `storage/follow-codes.js`), not of the column.
 *  - `follow_codes.organization_id` and `present_sessions.organization_id` are
 *    dropped. Nothing scopes either domain by organization: a follow code is a
 *    global handle resolved by a public endpoint, and a present session is
 *    authorized by possession of its session id (see the `crossOrganizationScope`
 *    call in `present-sessions/control.js`). Deleting an organization still
 *    cascades its sessions away, now through `presentation_id`. A column no
 *    code writes is the dormant-schema drift this track exists to remove.
 *  - `present_sessions.presentation_id` becomes `NOT NULL` and cascades on
 *    delete instead of nulling out. A session without a deck is not a session
 *    the in-memory model can represent, so `SET NULL` would have produced rows
 *    that every reader has to skip; cascade deletes them with the deck.
 *  - `present_sessions.follow_codes_created_at` is new. The in-memory session
 *    tracked `followCodesCreatedAt` to decide when to re-mint expired codes,
 *    but the disk format had no field for it, so the value never survived a
 *    restart. Persisting it keeps that decision correct across processes.
 *
 * No import: both domains are 24h-TTL ephemera (decision 4), so whatever sits
 * in `follow-codes.json` or `present-sessions/` on an upgrading install expires
 * on its own. Live sessions do not survive the upgrade — the release note says
 * so; do not upgrade mid-presentation.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // --- follow_codes -------------------------------------------------------
  // btrim, not a bare cast: char(n) blank-pads on read, so an existing value
  // would arrive with trailing spaces that no lookup would ever match.
  await sql`
    ALTER TABLE follow_codes
    ALTER COLUMN code TYPE TEXT USING btrim(code)
  `.execute(db);

  await sql`ALTER TABLE follow_codes DROP COLUMN IF EXISTS organization_id`.execute(
    db,
  );

  // --- present_sessions ---------------------------------------------------
  await sql`ALTER TABLE present_sessions DROP COLUMN IF EXISTS organization_id`.execute(
    db,
  );

  // Rows with no deck cannot exist (nothing ever wrote this table) and cannot
  // be represented once presentation_id is NOT NULL. Clear them rather than
  // let the constraint fail on a row that is meaningless anyway.
  await sql`DELETE FROM present_sessions WHERE presentation_id IS NULL`.execute(
    db,
  );

  // Drop every remaining foreign key on the table by looked-up name: the
  // constraint was created implicitly by the 001 table builder, so its name is
  // PostgreSQL's default and a hard-coded `DROP CONSTRAINT IF EXISTS` would
  // silently no-op on any install where it differs — leaving the old ON DELETE
  // SET NULL rule in place beside the new one.
  await sql`
    DO $$
    DECLARE con_name text;
    BEGIN
      FOR con_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = 'present_sessions'
          AND nsp.nspname = current_schema()
          AND con.contype = 'f'
      LOOP
        EXECUTE format('ALTER TABLE present_sessions DROP CONSTRAINT %I', con_name);
      END LOOP;
    END $$
  `.execute(db);

  await sql`
    ALTER TABLE present_sessions
    ALTER COLUMN presentation_id SET NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE present_sessions
    ADD CONSTRAINT present_sessions_presentation_id_fkey
    FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    ALTER TABLE present_sessions
    ADD COLUMN IF NOT EXISTS follow_codes_created_at TIMESTAMPTZ
  `.execute(db);
};

export const down = async (db) => {
  await sql`
    ALTER TABLE present_sessions DROP COLUMN IF EXISTS follow_codes_created_at
  `.execute(db);

  await sql`
    ALTER TABLE present_sessions
    DROP CONSTRAINT IF EXISTS present_sessions_presentation_id_fkey
  `.execute(db);

  await sql`
    ALTER TABLE present_sessions
    ALTER COLUMN presentation_id DROP NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE present_sessions
    ADD CONSTRAINT present_sessions_presentation_id_fkey
    FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE SET NULL
  `.execute(db);

  await sql`
    ALTER TABLE present_sessions
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_present_sessions_org
    ON present_sessions (organization_id)
  `.execute(db);

  // Narrowing back to char(4) cannot hold a five-character code. These rows are
  // 24h ephemera whose only value is being resolvable right now, so a rollback
  // discards them rather than failing halfway through the migration.
  await sql`DELETE FROM follow_codes`.execute(db);

  await sql`
    ALTER TABLE follow_codes
    ALTER COLUMN code TYPE CHAR(4) USING code::char(4)
  `.execute(db);

  await sql`
    ALTER TABLE follow_codes
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE
  `.execute(db);
};
