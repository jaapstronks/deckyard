/**
 * Worker initialization.
 * Initializes all background job workers when the queue system is available.
 */

import { initializeExportWorker } from './export-worker.js';
import { initializeTranslateWorker } from './translate-worker.js';
import { initializeBulkExportWorker } from './bulk-export-worker.js';

/**
 * Initialize all workers.
 * Should be called after queue system is initialized.
 * @returns {Promise<Object>} Worker status
 */
export async function initializeWorkers() {
  const workers = {};

  try {
    workers.export = await initializeExportWorker();
    workers.translate = await initializeTranslateWorker();
    workers.bulkExport = await initializeBulkExportWorker();

    const activeCount = Object.values(workers).filter(Boolean).length;
    console.log(`[workers] ${activeCount} workers initialized`);

    return {
      ok: true,
      workers: {
        export: !!workers.export,
        translate: !!workers.translate,
        bulkExport: !!workers.bulkExport,
      },
    };
  } catch (err) {
    console.warn('[workers] Failed to initialize workers:', err.message);
    return {
      ok: false,
      error: err.message,
    };
  }
}
