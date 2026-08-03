/**
 * Storage adapter factory.
 * Selects the appropriate storage backend based on configuration.
 */

import { getStorageMode } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('adapters');

/** @type {import('./interface.js').StorageAdapter | null} */
let adapter = null;

/**
 * Initialize the storage adapter based on configuration.
 * @param {string} repoRoot - Repository root path (needed for file adapter)
 * @returns {Promise<import('./interface.js').StorageAdapter>}
 */
export async function initializeStorage(repoRoot) {
  if (adapter) {
    return adapter;
  }

  const mode = getStorageMode();

  log.info(`[Storage] Mode: ${mode}`);

  if (mode === 'postgres') {
    const { PostgresAdapter } = await import('./postgres-adapter.js');
    adapter = new PostgresAdapter();
    await adapter.initialize();
    log.info('[Storage] Initialized PostgreSQL adapter');
  } else {
    const { FileAdapter } = await import('./file-adapter.js');
    adapter = new FileAdapter(repoRoot);
    await adapter.initialize();
    log.info('[Storage] Initialized file adapter');
  }

  return adapter;
}

/**
 * Get the current storage adapter.
 * @returns {import('./interface.js').StorageAdapter}
 * @throws {Error} If storage not initialized
 */
export function getStorage() {
  if (!adapter) {
    throw new Error('Storage not initialized. Call initializeStorage() first.');
  }
  return adapter;
}

/**
 * Check if storage is initialized.
 * @returns {boolean}
 */
export function isStorageInitialized() {
  return adapter !== null;
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