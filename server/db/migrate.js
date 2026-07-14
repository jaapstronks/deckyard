/**
 * Database migration runner.
 * Tracks applied migrations in a migrations table.
 *
 * Usage:
 *   node server/db/migrate.js up     # Run pending migrations
 *   node server/db/migrate.js down   # Rollback last migration
 *   node server/db/migrate.js status # Show migration status
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { getDatabaseConfig } from '../config/database.js';
import { loadDotEnv } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const { Pool } = pg;

async function createDb() {
  const config = getDatabaseConfig();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
  });

  return new Kysely({
    dialect: new PostgresDialect({ pool }),
  });
}

async function ensureMigrationsTable(db) {
  await db.schema
    .createTable('_migrations')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('name', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('executed_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();
}

async function getAppliedMigrations(db) {
  const rows = await db
    .selectFrom('_migrations')
    .select(['name', 'executed_at'])
    .orderBy('id', 'asc')
    .execute();
  return rows.map((r) => r.name);
}

async function getMigrationFiles() {
  const files = await fs.readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.js') && /^\d{3}_/.test(f))
    .sort();
}

async function runUp(db) {
  await ensureMigrationsTable(db);

  const applied = await getAppliedMigrations(db);
  const files = await getMigrationFiles();

  const pending = files.filter((f) => !applied.includes(f));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  for (const file of pending) {
    console.log(`Running migration: ${file}`);
    const migration = await import(path.join(MIGRATIONS_DIR, file));

    await db.transaction().execute(async (trx) => {
      await migration.up(trx);
      await trx
        .insertInto('_migrations')
        .values({ name: file })
        .execute();
    });

    console.log(`Completed: ${file}`);
  }

  console.log(`Applied ${pending.length} migration(s).`);
}

async function runDown(db) {
  await ensureMigrationsTable(db);

  const applied = await getAppliedMigrations(db);

  if (applied.length === 0) {
    console.log('No migrations to rollback.');
    return;
  }

  const lastMigration = applied[applied.length - 1];
  console.log(`Rolling back: ${lastMigration}`);

  const migration = await import(path.join(MIGRATIONS_DIR, lastMigration));

  await db.transaction().execute(async (trx) => {
    await migration.down(trx);
    await trx
      .deleteFrom('_migrations')
      .where('name', '=', lastMigration)
      .execute();
  });

  console.log(`Rolled back: ${lastMigration}`);
}

async function showStatus(db) {
  await ensureMigrationsTable(db);

  const applied = await getAppliedMigrations(db);
  const files = await getMigrationFiles();

  console.log('\nMigration Status:');
  console.log('─'.repeat(50));

  for (const file of files) {
    const status = applied.includes(file) ? '✓ Applied' : '○ Pending';
    console.log(`${status}  ${file}`);
  }

  console.log('─'.repeat(50));
  console.log(`Total: ${files.length} migration(s), ${applied.length} applied\n`);
}

async function main() {
  // Load .env file
  await loadDotEnv(REPO_ROOT);

  const command = process.argv[2] || 'status';

  console.log(`\nDatabase Migration Tool`);
  console.log(`Command: ${command}\n`);

  const db = await createDb();

  try {
    switch (command) {
      case 'up':
        await runUp(db);
        break;
      case 'down':
        await runDown(db);
        break;
      case 'status':
        await showStatus(db);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log('Usage: node migrate.js [up|down|status]');
        process.exit(1);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});