/**
 * Database migration runner.
 * Tracks applied migrations in a migrations table.
 *
 * Usage:
 *   node server/db/migrate.js up     # Run pending migrations
 *   node server/db/migrate.js down   # Rollback last migration
 *   node server/db/migrate.js status # Show migration status
 *
 * The runner is also a module: `createMigrationDb`, `runUp`, `runDown`,
 * `listMigrationFiles` and `listAppliedMigrations` are exported so a caller can
 * drive migrations without spawning the CLI — which is what
 * `scripts/migration-smoke-test.js` needs to roll the whole stack back and
 * forward in one connection. The CLI half only runs when this file *is* the
 * entry point, so importing it has no side effects.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { getDatabaseConfig } from '../config/database.js';
import { loadDotEnv } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const { Pool } = pg;

/**
 * Open a Kysely instance for migration work. The caller owns it and must
 * `destroy()` it, or the pool keeps the process alive.
 * @returns {Promise<import('kysely').Kysely<any>>}
 */
export async function createMigrationDb() {
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

/**
 * Names of the migrations recorded as applied, in execution order.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<string[]>}
 */
export async function listAppliedMigrations(db) {
  const rows = await db
    .selectFrom('_migrations')
    .select(['name', 'executed_at'])
    .orderBy('id', 'asc')
    .execute();
  return rows.map((r) => r.name);
}

/**
 * Migration filenames on disk, sorted — the numeric prefix is the order.
 * @returns {Promise<string[]>}
 */
export async function listMigrationFiles() {
  const files = await fs.readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.js') && /^\d{3}_/.test(f))
    .sort();
}

/**
 * Apply every migration that is not yet recorded as applied.
 * @param {import('kysely').Kysely<any>} db
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<string[]>} the migrations applied by this call
 */
export async function runUp(db, { log = console.log } = {}) {
  await ensureMigrationsTable(db);

  const applied = await listAppliedMigrations(db);
  const files = await listMigrationFiles();

  const pending = files.filter((f) => !applied.includes(f));

  if (pending.length === 0) {
    log('No pending migrations.');
    return [];
  }

  for (const file of pending) {
    log(`Running migration: ${file}`);
    const migration = await import(path.join(MIGRATIONS_DIR, file));

    await db.transaction().execute(async (trx) => {
      await migration.up(trx);
      await trx
        .insertInto('_migrations')
        .values({ name: file })
        .execute();
    });

    log(`Completed: ${file}`);
  }

  log(`Applied ${pending.length} migration(s).`);
  return pending;
}

/**
 * Roll back the most recently applied migration.
 * @param {import('kysely').Kysely<any>} db
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<string | null>} the migration rolled back, or null if none
 */
export async function runDown(db, { log = console.log } = {}) {
  await ensureMigrationsTable(db);

  const applied = await listAppliedMigrations(db);

  if (applied.length === 0) {
    log('No migrations to rollback.');
    return null;
  }

  const lastMigration = applied[applied.length - 1];
  log(`Rolling back: ${lastMigration}`);

  const migration = await import(path.join(MIGRATIONS_DIR, lastMigration));

  await db.transaction().execute(async (trx) => {
    await migration.down(trx);
    await trx
      .deleteFrom('_migrations')
      .where('name', '=', lastMigration)
      .execute();
  });

  log(`Rolled back: ${lastMigration}`);
  return lastMigration;
}

async function showStatus(db) {
  await ensureMigrationsTable(db);

  const applied = await listAppliedMigrations(db);
  const files = await listMigrationFiles();

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

  const db = await createMigrationDb();

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

// CLI half. Guarded so `import`ing this module for its runners does not also
// run a migration command.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}