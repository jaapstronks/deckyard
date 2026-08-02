#!/usr/bin/env node
/**
 * Migration smoke test: run the whole migration stack up, all the way back
 * down, and up again against an empty PostgreSQL.
 *
 * Why this exists: none of the migrations ran anywhere in CI. One of them is
 * exercised individually against the in-memory double; the rest ran for the
 * first time on staging or production, which made a deploy the first place a
 * broken migration could be found. This is the smallest thing that moves that
 * discovery into CI — see docs/plans/briefs/postgres-test-infra.md § D.
 *
 * What it proves, precisely:
 *  - every `up()` applies against a schema built by its predecessors;
 *  - every `down()` exists and undoes its `up()` far enough that the next
 *    `up()` succeeds — the round trip is the assertion, not a schema diff;
 *  - the runner's own bookkeeping (`_migrations`) stays consistent.
 *
 * What it does NOT prove: that the resulting schema is *correct*, or that any
 * query the storage layer writes works against it. That is the full
 * `services: postgres` test job (option A in the brief), still to come.
 *
 * Usage:
 *   DATABASE_NAME=deckyard_smoke node scripts/migration-smoke-test.js
 *
 * The database must exist and should be empty. Connection settings come from
 * the usual DATABASE_* env vars (server/config/database.js).
 */

import { sql } from 'kysely';

import {
  createMigrationDb,
  listAppliedMigrations,
  listMigrationFiles,
  runDown,
  runUp,
} from '../server/db/migrate.js';
import { loadDotEnv } from '../server/config/env.js';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Swallow the per-migration chatter; the phase summaries below are the signal. */
const quiet = () => {};

/**
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<string[]>} table names in the public schema, sorted
 */
async function publicTables(db) {
  const { rows } = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `.execute(db);
  return rows.map((r) => r.tablename).sort();
}

async function main() {
  await loadDotEnv(REPO_ROOT);
  const db = await createMigrationDb();

  try {
    const files = await listMigrationFiles();
    console.log(`Migration smoke test: ${files.length} migration(s) on disk.\n`);

    const before = await publicTables(db);
    if (before.length) {
      throw new Error(
        `Expected an empty database, found ${before.length} table(s): ${before.join(', ')}.\n` +
          'Point DATABASE_NAME at a scratch database — this script is destructive.'
      );
    }

    console.log('→ up (first pass)');
    const appliedFirst = await runUp(db, { log: quiet });
    if (appliedFirst.length !== files.length) {
      throw new Error(
        `up applied ${appliedFirst.length} migration(s), expected all ${files.length}.`
      );
    }
    const tablesAfterUp = await publicTables(db);
    console.log(`  ${appliedFirst.length} applied, ${tablesAfterUp.length} table(s) present.\n`);

    console.log('→ down (all the way back)');
    for (let i = files.length; i > 0; i -= 1) {
      const rolled = await runDown(db, { log: quiet });
      if (!rolled) throw new Error(`down stopped early: ${i} migration(s) still applied.`);
    }
    const stillApplied = await listAppliedMigrations(db);
    if (stillApplied.length) {
      throw new Error(`down left ${stillApplied.length} migration(s) applied.`);
    }
    console.log(`  ${files.length} rolled back.\n`);

    console.log('→ up (second pass)');
    const appliedSecond = await runUp(db, { log: quiet });
    if (appliedSecond.length !== files.length) {
      throw new Error(
        `second up applied ${appliedSecond.length} migration(s), expected all ${files.length}.`
      );
    }
    const tablesAfterReUp = await publicTables(db);
    console.log(`  ${appliedSecond.length} applied, ${tablesAfterReUp.length} table(s) present.\n`);

    // The round trip has to land on the same schema, or "down" is quietly
    // dropping something "up" no longer recreates. Table names are a coarse
    // check by design: a column-level comparison would duplicate the schema in
    // this file and rot the moment a migration lands.
    const missing = tablesAfterUp.filter((t) => !tablesAfterReUp.includes(t));
    const extra = tablesAfterReUp.filter((t) => !tablesAfterUp.includes(t));
    if (missing.length || extra.length) {
      throw new Error(
        'up → down → up did not reproduce the same tables.\n' +
          (missing.length ? `  missing after re-up: ${missing.join(', ')}\n` : '') +
          (extra.length ? `  unexpected after re-up: ${extra.join(', ')}\n` : '')
      );
    }

    console.log(`✓ ${files.length} migration(s) survive up → down → up.`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('\nMigration smoke test failed:\n');
  console.error(err);
  process.exit(1);
});
