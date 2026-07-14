/**
 * Migration to add 'admin' permission level for collaborators.
 *
 * The 'admin' permission allows a collaborator to:
 * - Edit the presentation (like 'edit' permission)
 * - Manage collaborators (add, remove, update permissions)
 *
 * This enables presentation-level admins who can delegate access without
 * being the owner of the presentation.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Drop the existing constraint
  await sql`
    ALTER TABLE presentation_collaborators
    DROP CONSTRAINT IF EXISTS check_collaborator_permission
  `.execute(db);

  // Add updated constraint with 'admin' permission
  await sql`
    ALTER TABLE presentation_collaborators
    ADD CONSTRAINT check_collaborator_permission
    CHECK (permission IN ('view', 'comment', 'edit', 'admin'))
  `.execute(db);
};

export const down = async (db) => {
  // First, downgrade any 'admin' permissions to 'edit'
  await sql`
    UPDATE presentation_collaborators
    SET permission = 'edit'
    WHERE permission = 'admin'
  `.execute(db);

  // Drop the updated constraint
  await sql`
    ALTER TABLE presentation_collaborators
    DROP CONSTRAINT IF EXISTS check_collaborator_permission
  `.execute(db);

  // Restore original constraint
  await sql`
    ALTER TABLE presentation_collaborators
    ADD CONSTRAINT check_collaborator_permission
    CHECK (permission IN ('view', 'comment', 'edit'))
  `.execute(db);
};