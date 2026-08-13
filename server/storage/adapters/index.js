/**
 * Storage adapter factory.
 * PostgreSQL is the only storage backend; disk-JSON storage was removed in
 * 1.x (run `npm run db:import` once against an old data directory to move it in).
 */

import { createLogger } from '../../utils/logger.js';
const log = createLogger('adapters');

/**
 * The composed PostgreSQL adapter — the storage contract, now that it is the
 * only backend. The shapes it exchanges with the facades live in `./types.js`.
 * @typedef {InstanceType<typeof import('./postgres/index.js').PostgresAdapter>} StorageAdapter
 */

/** @type {StorageAdapter | null} */
let adapter = null;

/**
 * Initialize the storage adapter.
 * @returns {Promise<StorageAdapter>}
 */
export async function initializeStorage() {
  if (adapter) {
    return adapter;
  }

  const { PostgresAdapter } = await import('./postgres/index.js');
  adapter = new PostgresAdapter();
  await adapter.initialize();
  log.info('[Storage] Initialized PostgreSQL adapter');

  return adapter;
}

/**
 * Get the current storage adapter.
 * @returns {StorageAdapter}
 * @throws {Error} If storage not initialized
 */
export function getStorage() {
  if (!adapter) {
    throw new Error('Storage not initialized. Call initializeStorage() first.');
  }
  return adapter;
}

/**
 * Close the storage adapter (for graceful shutdown).
 * @returns {Promise<void>}
 */
export async function closeStorage() {
  if (adapter) {
    await adapter.close();
    adapter = null;
  }
}

/**
 * Drop the active adapter without closing it (test-only).
 *
 * {@link closeStorage} closes the adapter, which for the PostgreSQL adapter
 * destroys the shared database handle. The real-PostgreSQL test suite
 * (tests/pg/**) owns that handle itself — it opened it through the
 * `__setTestDb()` seam and tears it down with `closeTestDb()` — so it needs to
 * reset the facade's adapter singleton *without* a second destroy. This clears
 * the singleton and nothing else.
 *
 * Test-only: production code closes storage through {@link closeStorage}.
 * @returns {void}
 */
export function __resetStorageForTests() {
  adapter = null;
}