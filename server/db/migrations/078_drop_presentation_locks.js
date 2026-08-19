/**
 * Migration: drop the presentation-level lock tables — B96 / decision D40
 * (`docs/plans/briefs/beslisdossier.md` § D40).
 *
 * `presentation_locks` (the whole-deck turn lock) and `lock_requests` (the
 * access hand-off queue behind it) were laid by migration 003 for turn-based
 * editing and given an id column by 071. That path died when the editor moved
 * to slide-level locking (`slide_locks`, migration 023): the client hardcoded
 * slide-level locking, the server-side switch (`USE_DB_LOCKS`) was never set
 * or documented, and nothing read either table any more. The code that wrote
 * them — storage, routes, client — goes in the same change as this migration,
 * so after it there is no reader or writer left on either side.
 *
 * Ordering is therefore free: the migration can run before or after the code
 * deploy. Nothing touches the tables in between.
 *
 * ## `down` recreates the tables empty — deliberately
 *
 * Lock rows are ephemeral (a 2-minute TTL plus a background sweep), and the
 * path was dead long before this migration, so there is no data to keep: a
 * `down` that restores the *schema* is all a rollback needs. It restores the
 * 003 definition **with** the 071 `holder_user_id` column, so a full
 * `up → down → up` round-trip (scripts/migration-smoke-test.js) lands on the
 * identical schema at every step — 071's `down` can still drop the column,
 * 003's `down` can still drop the tables. 003 and 071 themselves stay
 * untouched as history.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Indexes go with their tables; `IF EXISTS` on both keeps the migration
  // re-run safe. `lock_requests` first — it has no FK to `presentation_locks`,
  // but dropping the queue before the lock it queues for reads as the natural
  // order and mirrors 003's `down`.
  await db.schema
    .dropIndex('idx_lock_requests_presentation_status')
    .ifExists()
    .execute();
  await db.schema.dropTable('lock_requests').ifExists().execute();

  await db.schema
    .dropIndex('idx_presentation_locks_expires')
    .ifExists()
    .execute();
  await db.schema.dropTable('presentation_locks').ifExists().execute();
};

export const down = async (db) => {
  // Verbatim 003 definition + the 071 column (see docblock).
  await db.schema
    .createTable('presentation_locks')
    .ifNotExists()
    .addColumn('presentation_id', 'uuid', (col) =>
      col.primaryKey().references('presentations.id').onDelete('cascade'),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade'),
    )
    .addColumn('holder_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('holder_name', 'varchar(255)')
    .addColumn('acquired_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('refreshed_at', 'timestamptz', (col) =>
      col.defaultTo(sql`now()`),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('holder_user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('idx_presentation_locks_expires')
    .ifNotExists()
    .on('presentation_locks')
    .column('expires_at')
    .execute();

  await db.schema
    .createTable('lock_requests')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade'),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade'),
    )
    .addColumn('requester_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('requester_name', 'varchar(255)')
    .addColumn('message', 'text')
    .addColumn('status', 'varchar(20)', (col) => col.defaultTo('pending'))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('resolved_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_lock_requests_presentation_status')
    .ifNotExists()
    .on('lock_requests')
    .columns(['presentation_id', 'status'])
    .execute();
};
