/**
 * Shared setup for the real-PostgreSQL test suite (`tests/pg/**`).
 *
 * Every other test in the repo runs against `tests/helpers/fake-db.js`, an
 * in-memory double that models only the query shapes the storage layer uses.
 * That double is deliberately incomplete, and the places it diverges from a
 * real database are exactly the ones production finds first: a `DO UPDATE ...
 * WHERE` that returns no row, a conflict target that lists the wrong columns,
 * a `COALESCE(...) + n` upsert the double approximates as `<col> ± n`. This
 * suite installs a *real* Kysely handle instead, so those paths are exercised
 * against PostgreSQL itself. It is option A in
 * docs/plans/briefs/postgres-test-infra.md, the follow-up to the D/C migration
 * jobs (#548/#551).
 *
 * The seam is the same `__setTestDb()` the double uses (server/db/client.js):
 * once a handle is installed, every getDb()/withDbGuard() caller in the storage
 * layer transparently talks to it. Here that handle is a live connection.
 *
 * This suite never runs under `npm test` — its files are named `*.pgtest.js`,
 * which the default glob (matching `*.test.js` only) does not pick up. It runs
 * only via `npm run test:pg`, in the `test-postgres` CI job, against a database
 * the
 * migrations have already been applied to. See docs/developer/pg-test-suite.md.
 */

import { fileURLToPath } from 'node:url';

import { sql } from 'kysely';

import { createMigrationDb } from '../../../server/db/migrate.js';
import { loadDotEnv } from '../../../server/config/env.js';
import { __setTestDb } from '../../../server/db/client.js';

// `fileURLToPath`, not `.pathname`: a URL percent-encodes, so a checkout under
// a path with a space would hand `loadDotEnv` a `%20` and the `.env` would
// silently not load. Same reason server/db/migrate.js uses it.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let envLoaded = false;

/**
 * Open a real Kysely against the migrated scratch database and install it as
 * the storage-layer singleton, so the storage modules under test hit real
 * PostgreSQL. The caller owns the returned handle and must pass it to
 * {@link closeTestDb} in teardown, or the pool keeps the process alive.
 *
 * @returns {Promise<import('kysely').Kysely<any>>}
 */
export async function openTestDb() {
  if (!envLoaded) {
    await loadDotEnv(REPO_ROOT);
    envLoaded = true;
  }

  const db = await createMigrationDb();

  // This suite reads the schema the migrations produce; it does not create it.
  // An unmigrated database means the CI step that runs the migrations was
  // skipped (or, locally, `npm run db:migrate` was not pointed at the scratch
  // DB). Fail loud rather than let every test error on a missing table.
  const { rows } = await sql`SELECT to_regclass('public.slide_locks') AS present`.execute(db);
  if (!rows[0]?.present) {
    await db.destroy();
    throw new Error(
      'PG test suite: the database has no schema. Run the migrations against it ' +
        'first (`npm run db:migrate`), then run `npm run test:pg`.'
    );
  }

  __setTestDb(db);
  return db;
}

/**
 * Uninstall the test handle and close its pool.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<void>}
 */
export async function closeTestDb(db) {
  __setTestDb(null);
  if (db) await db.destroy();
}

/**
 * Empty the named tables and reset their identity sequences, so each test
 * starts from a known-empty state. CASCADE follows foreign keys, so passing a
 * parent table also clears its children.
 *
 * Table names are hard-coded test constants, never user input, so raw
 * interpolation is safe here (and TRUNCATE takes no bound parameters).
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {...string} tables
 * @returns {Promise<void>}
 */
export async function truncate(db, ...tables) {
  if (!tables.length) return;
  const list = tables.map((t) => `"${t}"`).join(', ');
  await sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`).execute(db);
}
