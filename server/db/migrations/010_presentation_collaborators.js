/**
 * Migration for presentation collaborators:
 * - Creates table to track workspace users invited to collaborate on presentations
 * - Distinct from share links: internal users with email-based access including edit permission
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Create presentation_collaborators table
  await db.schema
    .createTable('presentation_collaborators')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('user_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('permission', 'varchar(20)', (col) => col.notNull())
    .addColumn('invited_by', 'varchar(320)')
    .addColumn('invited_at', 'timestamptz', (col) =>
      col.defaultTo(sql`now()`)
    )
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revoked_by', 'varchar(320)')
    .execute();

  // Unique constraint for one collaborator per presentation per email
  await sql`
    ALTER TABLE presentation_collaborators
    ADD CONSTRAINT unique_collaborator
    UNIQUE (presentation_id, user_email)
  `.execute(db);

  // Check constraint for permission values
  await sql`
    ALTER TABLE presentation_collaborators
    ADD CONSTRAINT check_collaborator_permission
    CHECK (permission IN ('view', 'comment', 'edit'))
  `.execute(db);

  // Index for finding collaborators by presentation (active only)
  await sql`
    CREATE INDEX idx_collaborators_presentation
    ON presentation_collaborators(presentation_id)
    WHERE revoked_at IS NULL
  `.execute(db);

  // Index for finding presentations shared with a user (for "Shared with me" view)
  await sql`
    CREATE INDEX idx_collaborators_user
    ON presentation_collaborators(user_email, organization_id)
    WHERE revoked_at IS NULL
  `.execute(db);
};

export const down = async (db) => {
  await db.schema.dropTable('presentation_collaborators').execute();
};