/**
 * Migration: drop `view_sessions.organization_id`.
 *
 * The column has existed since migration 014 and never carried a trustworthy
 * value. The write path stamped `body.organizationId` — an organization the
 * *viewer's browser* claimed in the public tracking payload — while the only
 * reader, the GDPR export/erasure pair, filtered on the *authenticated
 * caller's* organization. Two different notions of "organization" in one
 * column, and the shipped client never sent the field at all, so in practice
 * every row stored NULL and a scoped erasure matched nothing: the endpoint
 * answered "Your analytics data has been deleted" after deleting zero rows
 * (found in #627).
 *
 * The doctrine settles which way it goes.
 * `docs/reference/tenant-isolation.md` § *Which domains partition on the
 * organization* rule R2: a content descendant inherits its organization
 * through its FK chain and carries no copy of it — and an existing unused
 * copy goes away rather than being half-filled. `view_sessions.presentation_id`
 * is NOT NULL and `presentations.organization_id` is authoritative, so the
 * organization of a view session is already knowable without this column.
 *
 * No data is lost that anyone can act on: the column is NULL for every row a
 * shipped client produced, no query filters on it after this commit, and it
 * carries no index or constraint besides its own FK.
 *
 * `down` restores the column as it was declared in 014 (nullable, FK to
 * organizations, cascade on delete). It does not restore values — there were
 * no trustworthy ones — which is the same honesty as migration 064's no-op
 * `down`.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`ALTER TABLE view_sessions DROP COLUMN IF EXISTS organization_id`.execute(db);
};

export const down = async (db) => {
  await sql`
    ALTER TABLE view_sessions
    ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES organizations(id) ON DELETE CASCADE
  `.execute(db);
};
