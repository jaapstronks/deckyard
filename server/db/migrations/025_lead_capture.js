/**
 * Migration for lead capture system:
 * - Lead submissions table for storing captured leads with GDPR compliance
 * - Consent proof storage for legal requirements
 * - Retention and anonymization support
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // ============================================================
  // LEAD SUBMISSIONS - Core lead capture storage with GDPR compliance
  // ============================================================

  await db.schema
    .createTable('lead_submissions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('slide_id', 'uuid', (col) => col.notNull())
    // Lead data
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    .addColumn('email', 'varchar(320)', (col) => col.notNull())
    // Consent proof (GDPR requirement)
    .addColumn('consent_given', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('consent_text', 'text', (col) => col.notNull())
    .addColumn('privacy_url', 'text')
    // Metadata
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'text')
    .addColumn('submitted_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // GDPR retention
    .addColumn('retention_expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('anonymized_at', 'timestamptz')
    // Timestamps
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Index for listing leads by presentation (main query pattern)
  await db.schema
    .createIndex('idx_lead_submissions_presentation')
    .on('lead_submissions')
    .columns(['presentation_id', 'submitted_at'])
    .execute();

  // Index for GDPR retention cleanup job
  await sql`
    CREATE INDEX IF NOT EXISTS idx_lead_submissions_retention
    ON lead_submissions(retention_expires_at)
    WHERE anonymized_at IS NULL
  `.execute(db);

  // Index for GDPR self-service data access/deletion by email
  await db.schema
    .createIndex('idx_lead_submissions_email')
    .on('lead_submissions')
    .column('email')
    .execute();

  // Index for filtering by slide
  await db.schema
    .createIndex('idx_lead_submissions_slide')
    .on('lead_submissions')
    .columns(['presentation_id', 'slide_id'])
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_lead_submissions_slide').ifExists().execute();
  await db.schema.dropIndex('idx_lead_submissions_email').ifExists().execute();
  await sql`DROP INDEX IF EXISTS idx_lead_submissions_retention`.execute(db);
  await db.schema.dropIndex('idx_lead_submissions_presentation').ifExists().execute();

  // Drop table
  await db.schema.dropTable('lead_submissions').ifExists().execute();
};
