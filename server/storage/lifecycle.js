/**
 * Storage lifecycle: bring the shared database handle up and down.
 *
 * Every storage domain now reaches PostgreSQL through direct Kysely on
 * `getDb()` (B79 / D34 stripped the adapter class), so "initializing storage" is
 * just opening the database pool. These thin wrappers keep the historical
 * `initializeStorage()` / `closeStorage()` names the server bootstrap
 * (server/server.js), the MCP server (server/mcp/index.js) and the test suites
 * call, over `server/db/client.js`'s already-idempotent `initializeDatabase()` /
 * `closeDatabase()`.
 *
 * The sentinel behaviour the storage layer relies on is unchanged and lives in
 * `db/client.js`: `initializeDatabase()` is idempotent (a second call returns
 * the open handle), and `getDb()` throws before it has run — so a facade that
 * queries before init still fails loud rather than degrading silently.
 *
 * `db/client.js` (and through it kysely + pg) is loaded **lazily**, inside the
 * calls below, so importing this module does not pull the database driver into
 * the graph of a script that never actually initializes storage — the property
 * the old adapter factory had and docs/reference/dynamic-imports.md records.
 */

/**
 * Open the database pool (idempotent). In `STORAGE_MODE=file` this is a no-op,
 * and when a test has injected a handle via `__setTestDb` the existing handle
 * is returned rather than a second pool being opened.
 * @returns {Promise<void>}
 */
export async function initializeStorage() {
  const { initializeDatabase } = await import('../db/client.js');
  await initializeDatabase();
}

/**
 * Close the database pool (graceful shutdown).
 * @returns {Promise<void>}
 */
export async function closeStorage() {
  const { closeDatabase } = await import('../db/client.js');
  await closeDatabase();
}

/**
 * Test-only: previously dropped the facade's adapter singleton without closing
 * the shared handle. That singleton is gone — the facades hold no storage state,
 * they read the current handle from `getDb()` — so there is nothing to reset:
 * the handle lives in `server/db/client.js` and is owned by whoever installed it
 * (`__setTestDb`, for the real-PostgreSQL suite) or by {@link closeStorage}.
 * Kept as a no-op so the test teardowns that call it need no churn.
 * @returns {void}
 */
export function __resetStorageForTests() {
  // No adapter singleton remains to clear (B79 / D34); the DB handle is managed
  // in db/client.js. Intentionally does nothing.
}
