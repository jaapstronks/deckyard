/**
 * Migration: make `presentation_collaborators.organization_id` mean what the
 * code now says it means — the organization of the *deck*, not of whoever
 * happened to be logged in when the invite was sent.
 *
 * The write path used to stamp `getOrgId(ctx)`, the inviter's session
 * organization. On a single-workspace instance those are always the same value
 * and nothing was visibly wrong; across workspaces they diverge, and a row
 * stamped with the inviter's org was invisible to reads that scope on the
 * deck's org — the asymmetry #623 surfaced (a cross-workspace collaborator
 * could open a deck but not its versions or thumbnail).
 *
 * `server/storage/collaborators.js` now resolves the stamp from the
 * presentation itself and no longer filters reads on it at all:
 * `(presentation_id, user_email)` is unique (migration 010) and a presentation
 * id is a globally unique uuid, so the deck already *is* the scope. That leaves
 * this column as a denormalized copy — useful for the per-user "shared with me"
 * listing and its index, worthless if it disagrees with the deck.
 *
 * So: re-stamp the rows written under the old rule. This changes no access
 * decision on the code in this commit (the authorization read ignores the
 * column); it keeps the column honest for the listing that does read it, and
 * for anyone reasoning about the table directly.
 *
 * Idempotent by construction: `IS DISTINCT FROM` makes a second run a no-op,
 * and it also repairs rows whose organization_id is NULL (the column has always
 * been nullable).
 *
 * Not reversible: the pre-migration values were the inviter's session
 * organization, which is not recoverable from any surviving column — and
 * restoring them would restore the defect. `down` is therefore a no-op rather
 * than a lie, matching how the schema-neutral repairs elsewhere behave.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    UPDATE presentation_collaborators c
    SET organization_id = p.organization_id
    FROM presentations p
    WHERE p.id = c.presentation_id
      AND c.organization_id IS DISTINCT FROM p.organization_id
  `.execute(db);
};

export const down = async () => {
  // Intentionally empty — see the header: the old values were the inviter's
  // session organization and are not recoverable, and re-introducing them would
  // re-introduce the defect this migration repairs.
};
