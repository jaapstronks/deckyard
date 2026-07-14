/**
 * Migration for access revoked messages feature:
 * - Add revocation_message to share links and collaborators
 * - Add trash_message to presentations
 * - Create access_attempt_log table for tracking and author notifications
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // ============================================================
  // ADD REVOCATION MESSAGE TO SHARE LINKS
  // ============================================================

  // Check if column exists before adding (idempotent)
  const shareLinksCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'presentation_share_links' AND column_name = 'revocation_message'
  `.execute(db);

  if (shareLinksCols.rows.length === 0) {
    await db.schema
      .alterTable('presentation_share_links')
      .addColumn('revocation_message', 'text')
      .execute();
  }

  // ============================================================
  // ADD REVOCATION MESSAGE TO COLLABORATORS
  // ============================================================

  const collaboratorsCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'presentation_collaborators' AND column_name = 'revocation_message'
  `.execute(db);

  if (collaboratorsCols.rows.length === 0) {
    await db.schema
      .alterTable('presentation_collaborators')
      .addColumn('revocation_message', 'text')
      .execute();
  }

  // ============================================================
  // ADD TRASH MESSAGE TO PRESENTATIONS (via JSON in file storage)
  // Note: Presentations use file-based storage, so this is just
  // a placeholder comment. The trashMessage field will be added
  // to the JSON schema in the storage layer.
  // ============================================================

  // ============================================================
  // ACCESS ATTEMPT LOG - Track attempts to access revoked content
  // ============================================================

  await db.schema
    .createTable('access_attempt_log')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade')
    )
    // Type of access that was attempted
    .addColumn('access_type', 'varchar(50)', (col) => col.notNull())
    // Reference to share link or collaborator record if applicable
    .addColumn('access_reference_id', 'uuid')
    // Accessor information
    .addColumn('accessor_email', 'varchar(320)')
    .addColumn('accessor_ip', 'varchar(45)')
    // Timestamps
    .addColumn('attempted_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('author_notified_at', 'timestamptz')
    .execute();

  // Index for querying by presentation (for author to see attempts)
  await db.schema
    .createIndex('idx_access_attempt_log_presentation')
    .ifNotExists()
    .on('access_attempt_log')
    .columns(['presentation_id', 'attempted_at'])
    .execute();

  // Index for rate limiting notifications (1 per accessor per 24h)
  await db.schema
    .createIndex('idx_access_attempt_log_accessor')
    .ifNotExists()
    .on('access_attempt_log')
    .columns(['presentation_id', 'accessor_email', 'attempted_at'])
    .execute();

  // Index for organization-scoped queries
  await db.schema
    .createIndex('idx_access_attempt_log_org')
    .ifNotExists()
    .on('access_attempt_log')
    .column('organization_id')
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_access_attempt_log_org').ifExists().execute();
  await db.schema.dropIndex('idx_access_attempt_log_accessor').ifExists().execute();
  await db.schema.dropIndex('idx_access_attempt_log_presentation').ifExists().execute();

  // Drop access_attempt_log table
  await db.schema.dropTable('access_attempt_log').ifExists().execute();

  // Remove columns from collaborators
  await db.schema
    .alterTable('presentation_collaborators')
    .dropColumn('revocation_message')
    .execute();

  // Remove columns from share links
  await db.schema
    .alterTable('presentation_share_links')
    .dropColumn('revocation_message')
    .execute();
};
