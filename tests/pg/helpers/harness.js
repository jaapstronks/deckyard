/**
 * Shared setup for the real-PostgreSQL test suite (`tests/pg/**`).
 *
 * Every other test in the repo runs against `tests/helpers/fake-db.js`, an
 * in-memory double that models only the query shapes the storage layer uses.
 * That double is deliberately incomplete, and the places it diverges from a
 * real database are exactly the ones production finds first: a `DO UPDATE ...
 * WHERE` that returns no row, a conflict target that lists the wrong columns,
 * a `COALESCE(...) + n` upsert the double approximates as `<col> ± n`, a
 * NOT NULL foreign key the double never enforces. This suite installs a *real*
 * Kysely handle instead, so those paths are exercised against PostgreSQL
 * itself. It is option A in docs/plans/briefs/postgres-test-infra.md, the
 * follow-up to the D/C migration jobs (#548/#551).
 *
 * ## Two seams, two shapes of test
 *
 * The database seam is the same `__setTestDb()` the double uses
 * (server/db/client.js): once a handle is installed, every getDb()/
 * withDbGuard() caller in the storage layer transparently talks to it. Here
 * that handle is a live connection.
 *
 *  - **Storage-module tests** (api-usage, slide-locks) import a storage
 *    function directly and only need the db handle installed. Use
 *    {@link openTestDb} / {@link closeTestDb}.
 *  - **Facade tests** (tags, collections, …) drive the public storage facade
 *    (`server/storage/<domain>/index.js`), which dispatches to whichever
 *    adapter `getStorage()` returns. To exercise the PostgreSQL adapter through
 *    that facade — the coverage that must survive the file adapter's removal
 *    (PR G) — use {@link installFacadeStorage} / {@link uninstallFacadeStorage}
 *    around the db handle.
 *
 * ## The DATABASE_URL gate
 *
 * These tests TRUNCATE tables, so they must never touch a real workspace
 * database. They therefore run **only** when `DATABASE_URL` names a throwaway
 * Postgres — a signal a normal dev `.env` (which configures the app through
 * `DATABASE_HOST`/`DATABASE_NAME`, not `DATABASE_URL`) does not carry. With it
 * unset the suite skips via {@link pgDescribe}; a bare `npm run test:pg` is
 * inert. In CI the `test-postgres` job sets `DATABASE_URL` at a dedicated
 * scratch database. Locally:
 *
 *     createdb deckyard_pg_tests
 *     DATABASE_NAME=deckyard_pg_tests npm run db:migrate
 *     DATABASE_URL=postgres://deckyard:pw@localhost:5432/deckyard_pg_tests \
 *       npm run test:pg
 *
 * This suite never runs under `npm test` — its files are named `*.pgtest.js`,
 * which the default glob (matching `*.test.js` only) does not pick up. See
 * docs/developer/pg-test-suite.md.
 */

import { describe } from 'node:test';

import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';

import { __setTestDb } from '../../../server/db/client.js';
import {
  initializeStorage,
  __resetStorageForTests,
} from '../../../server/storage/adapters/index.js';

const { Pool } = pg;

/**
 * Whether the real-PostgreSQL suite is configured to run.
 *
 * True exactly when `DATABASE_URL` is set. This is a synchronous read of
 * `process.env` so {@link pgDescribe} can decide skip-or-run at describe time.
 * @returns {boolean}
 */
export function pgTestsConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

const SKIP_REASON =
  'DATABASE_URL not set — the real-PostgreSQL suite runs only against a ' +
  'throwaway database (see docs/developer/pg-test-suite.md).';

/**
 * `describe` that skips the whole block, with a clear reason, unless a
 * throwaway Postgres is configured via `DATABASE_URL`.
 *
 * @param {string} title
 * @param {() => void} body
 * @returns {void}
 */
export function pgDescribe(title, body) {
  describe(title, { skip: pgTestsConfigured() ? false : SKIP_REASON }, body);
}

/**
 * Open a real Kysely against the throwaway database named by `DATABASE_URL`
 * and install it as the storage-layer singleton, so the storage modules under
 * test hit real PostgreSQL. The caller owns the returned handle and must pass
 * it to {@link closeTestDb} in teardown, or the pool keeps the process alive.
 *
 * @returns {Promise<import('kysely').Kysely<any>>}
 */
export async function openTestDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // pgDescribe should have skipped; guard anyway so a misuse fails loud
    // rather than connecting to whatever DATABASE_* happens to point at.
    throw new Error('openTestDb() requires DATABASE_URL (throwaway Postgres).');
  }

  const db = new Kysely({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });

  // This suite reads the schema the migrations produce; it does not create it.
  // An unmigrated database means the CI step that runs the migrations was
  // skipped (or, locally, `npm run db:migrate` was not pointed at the scratch
  // DB). Fail loud rather than let every test error on a missing table.
  const { rows } = await sql`SELECT to_regclass('public.slide_locks') AS present`.execute(db);
  if (!rows[0]?.present) {
    await db.destroy();
    throw new Error(
      'PG test suite: the database has no schema. Run the migrations against it ' +
        'first (`DATABASE_NAME=… npm run db:migrate`), then run `npm run test:pg`.'
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
 * Point the storage facade at the PostgreSQL adapter, wired to the already-open
 * test handle. Call after {@link openTestDb}: the adapter's initialize() finds
 * the injected handle and reuses it instead of opening a second pool.
 *
 * Facade functions (`listTags(scope)`, …) then run their real dispatch path
 * against real PostgreSQL — the same path the running server uses in
 * `STORAGE_MODE=postgres`.
 *
 * @returns {Promise<void>}
 */
export async function installFacadeStorage() {
  // getStorageMode() reads this fresh; the PostgresAdapter branch of
  // initializeStorage() is what wires the facade to the injected handle.
  process.env.STORAGE_MODE = 'postgres';
  // repoRoot is unused by the PostgreSQL adapter; pass a harmless placeholder.
  await initializeStorage();
}

/**
 * Drop the facade's adapter singleton without closing the shared handle (the
 * test owns it, and {@link closeTestDb} destroys it). Pair with
 * {@link installFacadeStorage}.
 * @returns {void}
 */
export function uninstallFacadeStorage() {
  __resetStorageForTests();
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
