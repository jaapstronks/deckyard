/**
 * GDPR self-service verification tokens.
 *
 * The lead my-data flow (`POST /api/leads/my-data/request` → e-mailed link →
 * `GET`/`DELETE /api/leads/my-data`) proves the anonymous data subject owns an
 * address by mailing them a short-lived `crypto.randomBytes(32)` token. That
 * token used to live in a per-process in-memory `Map`, which does not survive a
 * restart and cannot validate across a horizontally scaled deployment (a token
 * minted on node A is invisible to node B). This table is the durable form,
 * mirroring the analytics track-erase whose token is already a DB row
 * (`view_sessions`) rather than in-memory state.
 *
 * One active token per address: a fresh request replaces the previous row
 * (upsert on the `email` primary key), matching the old `Map.set(email, …)`
 * semantics exactly.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema
    .createTable('gdpr_verification_tokens')
    // One active token per address; a new request upserts over the old one.
    .addColumn('email', 'varchar(320)', (col) => col.primaryKey())
    // hex of 32 random bytes = 64 chars.
    .addColumn('token', 'varchar(64)', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Sweep index for expired-token cleanup.
  await db.schema
    .createIndex('idx_gdpr_verification_tokens_expiry')
    .on('gdpr_verification_tokens')
    .column('expires_at')
    .execute();
};

export const down = async (db) => {
  await db.schema.dropIndex('idx_gdpr_verification_tokens_expiry').ifExists().execute();
  await db.schema.dropTable('gdpr_verification_tokens').ifExists().execute();
};
