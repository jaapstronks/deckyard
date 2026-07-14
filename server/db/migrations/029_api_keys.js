/**
 * Migration for public API key functionality.
 * Creates tables for API key storage and usage tracking.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // API keys table
  await db.schema
    .createTable('api_keys')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('owner_email', 'varchar(320)', (col) => col.notNull())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('key_prefix', 'varchar(12)', (col) => col.notNull())
    .addColumn('key_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('tier', 'varchar(20)', (col) => col.defaultTo('free'))
    .addColumn('scopes', 'jsonb', (col) => col.defaultTo(sql`'["read", "write"]'::jsonb`))
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Index for key lookup by hash (only active keys)
  await db.schema
    .createIndex('idx_api_keys_hash')
    .on('api_keys')
    .column('key_hash')
    .where('revoked_at', 'is', null)
    .execute();

  // Index for key lookup by prefix (for display/identification)
  await db.schema
    .createIndex('idx_api_keys_prefix')
    .on('api_keys')
    .column('key_prefix')
    .execute();

  // Index for listing keys by owner
  await db.schema
    .createIndex('idx_api_keys_owner')
    .on('api_keys')
    .columns(['owner_email', 'created_at'])
    .execute();

  // Index for listing keys by organization
  await db.schema
    .createIndex('idx_api_keys_org')
    .on('api_keys')
    .columns(['organization_id', 'created_at'])
    .execute();

  // API usage tracking table (daily aggregates)
  await db.schema
    .createTable('api_usage_daily')
    .ifNotExists()
    .addColumn('api_key_id', 'uuid', (col) =>
      col.references('api_keys.id').onDelete('cascade').notNull()
    )
    .addColumn('date', 'date', (col) => col.notNull())
    .addColumn('request_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('ai_request_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('export_count', 'integer', (col) => col.defaultTo(0))
    .addPrimaryKeyConstraint('api_usage_daily_pkey', ['api_key_id', 'date'])
    .execute();

  // Index for usage queries by date
  await db.schema
    .createIndex('idx_api_usage_daily_date')
    .on('api_usage_daily')
    .column('date')
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_api_usage_daily_date').ifExists().execute();
  await db.schema.dropIndex('idx_api_keys_org').ifExists().execute();
  await db.schema.dropIndex('idx_api_keys_owner').ifExists().execute();
  await db.schema.dropIndex('idx_api_keys_prefix').ifExists().execute();
  await db.schema.dropIndex('idx_api_keys_hash').ifExists().execute();

  // Drop tables
  await db.schema.dropTable('api_usage_daily').ifExists().execute();
  await db.schema.dropTable('api_keys').ifExists().execute();
};
