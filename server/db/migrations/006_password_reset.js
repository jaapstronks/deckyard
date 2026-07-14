/**
 * Migration for password reset functionality:
 * - Add password storage fields to users table for database auth
 * - Password reset tokens table for secure token-based resets
 * - Auth audit log for security tracking
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Add password-related columns to users table
  await db.schema
    .alterTable('users')
    .addColumn('password_hash', 'varchar(255)')
    .execute();

  await db.schema
    .alterTable('users')
    .addColumn('password_changed_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('users')
    .addColumn('auth_source', 'varchar(20)', (col) => col.defaultTo('env'))
    .execute();

  // Password reset tokens table
  await db.schema
    .createTable('password_reset_tokens')
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
    .createIndex('idx_password_reset_tokens_hash')
    .on('password_reset_tokens')
    .column('token_hash')
    .where('used_at', 'is', null)
    .execute();

  // Index for rate limiting by email
  await db.schema
    .createIndex('idx_password_reset_tokens_email_created')
    .on('password_reset_tokens')
    .columns(['user_email', 'created_at'])
    .execute();

  // Index for cleanup of expired tokens
  await db.schema
    .createIndex('idx_password_reset_tokens_expires')
    .on('password_reset_tokens')
    .column('expires_at')
    .execute();

  // Auth audit log table for security tracking
  await db.schema
    .createTable('auth_audit_log')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_email', 'varchar(320)')
    .addColumn('event_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('success', 'boolean', (col) => col.defaultTo(false))
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'text')
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Index for audit log queries by email
  await db.schema
    .createIndex('idx_auth_audit_log_email')
    .on('auth_audit_log')
    .columns(['user_email', 'created_at'])
    .execute();

  // Index for audit log queries by event type
  await db.schema
    .createIndex('idx_auth_audit_log_event')
    .on('auth_audit_log')
    .columns(['event_type', 'created_at'])
    .execute();

  // Index for rate limiting by IP
  await db.schema
    .createIndex('idx_auth_audit_log_ip')
    .on('auth_audit_log')
    .columns(['ip_address', 'created_at'])
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_auth_audit_log_ip').ifExists().execute();
  await db.schema.dropIndex('idx_auth_audit_log_event').ifExists().execute();
  await db.schema.dropIndex('idx_auth_audit_log_email').ifExists().execute();
  await db.schema.dropIndex('idx_password_reset_tokens_expires').ifExists().execute();
  await db.schema.dropIndex('idx_password_reset_tokens_email_created').ifExists().execute();
  await db.schema.dropIndex('idx_password_reset_tokens_hash').ifExists().execute();

  // Drop tables
  await db.schema.dropTable('auth_audit_log').ifExists().execute();
  await db.schema.dropTable('password_reset_tokens').ifExists().execute();

  // Remove columns from users table
  await db.schema
    .alterTable('users')
    .dropColumn('auth_source')
    .execute();

  await db.schema
    .alterTable('users')
    .dropColumn('password_changed_at')
    .execute();

  await db.schema
    .alterTable('users')
    .dropColumn('password_hash')
    .execute();
};