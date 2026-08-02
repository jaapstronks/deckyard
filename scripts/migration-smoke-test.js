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
 *  - rolling everything back leaves an empty schema — `_migrations` and nothing
 *    else. Most migrations create with IF NOT EXISTS, so a `down()` that forgets
 *    a table would sail through a second `up()`; the leftover table is the tell;
 *  - every `down()` undoes its `up()` far enough that the next `up()` succeeds,
 *    and the round trip lands on the same tables — not a schema diff;
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

import { fileURLToPath } from 'node:url';

import { sql } from 'kysely';

import {
  createMigrationDb,
  listAppliedMigrations,
  listMigrationFiles,
  runDown,
  runUp,
} from '../server/db/migrate.js';
import { loadDotEnv } from '../server/config/env.js';

// `fileURLToPath`, not `.pathname`: a URL percent-encodes, so a checkout under
// a directory with a space would hand `loadDotEnv` a path containing `%20` and
// the `.env` would silently not load. Same reason `server/db/migrate.js` uses it.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

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
    if (!files.length) {
      // Every count check below compares against `files.length`, so zero
      // migrations would make the whole run pass without asserting anything —
      // the failure mode of a broken glob or a moved migrations directory.
      throw new Error(
        'Found no migrations on disk. Expected server/db/migrations/ to hold ' +
          'numbered `NNN_*.js` files; a smoke test over zero migrations proves nothing.'
      );
    }
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

    // Bookkeeping being empty is not the same as the schema being empty. Most
    // migrations create with IF NOT EXISTS, so a `down()` that forgets to drop
    // a table survives the second `up()` unnoticed; only the leftover object
    // itself gives it away. `_migrations` is the runner's own table and is
    // never dropped by a migration, so it is the one expected survivor.
    const tablesAfterDown = await publicTables(db);
    const leftovers = tablesAfterDown.filter((t) => t !== '_migrations');
    if (leftovers.length || !tablesAfterDown.includes('_migrations')) {
      throw new Error(
        'down did not leave the schema empty.\n' +
          `  expected only _migrations, found: ${tablesAfterDown.join(', ') || '(nothing)'}\n` +
          (leftovers.length
            ? `  a down() is not dropping: ${leftovers.join(', ')}\n`
            : '  the _migrations bookkeeping table is gone\n')
      );
    }
    console.log(`  ${files.length} rolled back, schema back to _migrations only.\n`);

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
