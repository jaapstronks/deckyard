/**
 * Migration: drop the lead-capture tables — B119 / decision D50
 * (`docs/plans/briefs/lead-capture-strip.md`).
 *
 * `lead_submissions` (migration 025) held the name/e-mail a viewer typed into
 * a lead-capture slide, plus the consent proof and the retention stamp.
 * `gdpr_verification_tokens` (migration 075) held the short-lived token that
 * let an anonymous data subject view and erase those rows without an account.
 * Both existed only for that one feature: the slide type went in the first PR
 * of the strip, and the routes, storage, retention sweep, notification e-mail
 * and self-service page go in the same change as this migration. After it,
 * neither table has a reader or a writer left.
 *
 * Nothing else reads them. Share-link guests carry their own
 * `verification_token` columns (`server/storage/share-links/guests.js`), and
 * the analytics erase path has its own token on `view_sessions` — both stay.
 *
 * Ordering is therefore free: this can run before or after the code deploy,
 * because nothing touches the tables in between.
 *
 * ## `down` recreates the tables empty — deliberately
 *
 * There is no data to preserve: a rollback needs the *schema* back, not the
 * rows. `lead_submissions` is restored as 025 defined it **with** the 051
 * conversion applied (`slide_id` is `text`, not `uuid` — slide IDs are
 * arbitrary strings from the deck JSON), so a full `up → down → up`
 * round-trip (`scripts/migration-smoke-test.js`) lands on the identical schema
 * at every step: 051's `down` can still convert the column back, 025's and
 * 075's `down` can still drop the tables. 025, 051 and 075 themselves stay
 * untouched as history.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Indexes go with their tables; `IF EXISTS` throughout keeps the migration
  // re-run safe. Tokens first — they gate access to the submissions, so
  // dropping the key before the lock reads as the natural order.
  await db.schema
    .dropIndex('idx_gdpr_verification_tokens_expiry')
    .ifExists()
    .execute();
  await db.schema.dropTable('gdpr_verification_tokens').ifExists().execute();

  await db.schema.dropIndex('idx_lead_submissions_slide').ifExists().execute();
  await db.schema.dropIndex('idx_lead_submissions_email').ifExists().execute();
  await sql`DROP INDEX IF EXISTS idx_lead_submissions_retention`.execute(db);
  await db.schema
    .dropIndex('idx_lead_submissions_presentation')
    .ifExists()
    .execute();
  await db.schema.dropTable('lead_submissions').ifExists().execute();
};

export const down = async (db) => {
  // Verbatim 025 definition, with 051's `slide_id` conversion folded in.
  await db.schema
    .createTable('lead_submissions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade'),
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull(),
    )
    // `text`, not 025's `uuid`: migration 051 converted every slide-reference
    // column, and `tests/slide-id-columns-text.test.js` holds that invariant.
    .addColumn('slide_id', 'text', (col) => col.notNull())
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    .addColumn('email', 'varchar(320)', (col) => col.notNull())
    .addColumn('consent_given', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn('consent_text', 'text', (col) => col.notNull())
    .addColumn('privacy_url', 'text')
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'text')
    .addColumn('submitted_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('retention_expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('anonymized_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_lead_submissions_presentation')
    .ifNotExists()
    .on('lead_submissions')
    .columns(['presentation_id', 'submitted_at'])
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_lead_submissions_retention
    ON lead_submissions(retention_expires_at)
    WHERE anonymized_at IS NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_lead_submissions_email')
    .ifNotExists()
    .on('lead_submissions')
    .column('email')
    .execute();

  await db.schema
    .createIndex('idx_lead_submissions_slide')
    .ifNotExists()
    .on('lead_submissions')
    .columns(['presentation_id', 'slide_id'])
    .execute();

  // Verbatim 075 definition.
  await db.schema
    .createTable('gdpr_verification_tokens')
    .ifNotExists()
    .addColumn('email', 'varchar(320)', (col) => col.primaryKey())
    .addColumn('token', 'varchar(64)', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_gdpr_verification_tokens_expiry')
    .ifNotExists()
    .on('gdpr_verification_tokens')
    .column('expires_at')
    .execute();
};
