/**
 * Migration for magic link (passwordless login) functionality.
 * Creates tokens table for secure one-time login links.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Magic link tokens table
  await db.schema
    .createTable('magic_link_tokens')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('token_hash', 'varchar(128)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'text')
    .execute();

  // Index for token lookup (only unused tokens)
  await db.schema
    .createIndex('idx_magic_link_tokens_hash')
    .on('magic_link_tokens')
    .column('token_hash')
    .where('used_at', 'is', null)
    .execute();

  // Index for rate limiting by email
  await db.schema
    .createIndex('idx_magic_link_tokens_email_created')
    .on('magic_link_tokens')
    .columns(['user_email', 'created_at'])
    .execute();

  // Index for rate limiting by IP
  await db.schema
    .createIndex('idx_magic_link_tokens_ip_created')
    .on('magic_link_tokens')
    .columns(['ip_address', 'created_at'])
    .execute();

  // Index for cleanup of expired tokens
  await db.schema
    .createIndex('idx_magic_link_tokens_expires')
    .on('magic_link_tokens')
    .column('expires_at')
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_magic_link_tokens_expires').ifExists().execute();
  await db.schema.dropIndex('idx_magic_link_tokens_ip_created').ifExists().execute();
  await db.schema.dropIndex('idx_magic_link_tokens_email_created').ifExists().execute();
  await db.schema.dropIndex('idx_magic_link_tokens_hash').ifExists().execute();

  // Drop table
  await db.schema.dropTable('magic_link_tokens').ifExists().execute();
};