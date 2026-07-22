/**
 * Storage adapter factory.
 * Selects the appropriate storage backend based on configuration.
 */

import { getStorageMode, getDualWriteMode } from '../../config/database.js';
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
  const dualWriteMode = getDualWriteMode();

  log.info(`[Storage] Mode: ${mode}, Dual-write: ${dualWriteMode}`);

  if (dualWriteMode !== 'off') {
    // Dual-write mode: use both adapters
    const { FileAdapter } = await import('./file-adapter.js');
    const { PostgresAdapter } = await import('./postgres-adapter.js');
    const { DualWriteAdapter } = await import('./dual-write-adapter.js');

    const fileAdapter = new FileAdapter(repoRoot);
    const postgresAdapter = new PostgresAdapter();

    await fileAdapter.initialize();
    await postgresAdapter.initialize();

    adapter = new DualWriteAdapter(fileAdapter, postgresAdapter, {
      mode: dualWriteMode,
    });
    log.info(`[Storage] Initialized dual-write adapter (mode: ${dualWriteMode})`);
  } else if (mode === 'postgres') {
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