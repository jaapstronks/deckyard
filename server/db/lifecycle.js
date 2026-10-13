/**
 * Storage lifecycle: bring the shared database handle up and down.
 *
 * Every storage domain reaches PostgreSQL through direct Kysely on `getDb()`
 * (B79 / D34 stripped the adapter class), so "initializing storage" is just
 * opening the database pool. This is the bootstrap seam for consumers outside
 * the storage layer (server/server.js, server/mcp/index.js, scripts and the
 * test suites), which may not import `client.js` itself: it wraps the
 * already-idempotent `initializeDatabase()` / `closeDatabase()`. It lives in
 * the database layer, not under `server/storage/`, because it opens a pool and
 * acts for no organization (B665).
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
 * Open the database pool (idempotent). PostgreSQL is the only storage backend,
 * so there is no mode in which this does nothing; when a test has injected a
 * handle via `__setTestDb` the existing handle is returned rather than a second
 * pool being opened.
 *
 * Throws when the database cannot be reached. The server's boot guard turns
 * that into a refusal naming the connection and the fix
 * (`databaseConnectionError` in server/config/database.js).
 * @returns {Promise<void>}
 */
export async function initializeStorage() {
  const { initializeDatabase } = await import('./client.js');
  await initializeDatabase();
}

/**
 * Close the database pool (graceful shutdown).
 * @returns {Promise<void>}
 */
export async function closeStorage() {
  const { closeDatabase } = await import('./client.js');
  await closeDatabase();
}
