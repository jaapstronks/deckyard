/**
 * PostgreSQL storage adapter using Kysely.
 *
 * Every storage domain now reaches Postgres through direct Kysely on `getDb()`
 * (B79 / D34); no domain mixins remain. What is left here is connection
 * lifecycle only — `initialize()`/`close()` around the shared database handle —
 * which the storage facades still bootstrap via `initializeStorage()`. The
 * whole adapter directory is removed in the final strip PR once that lifecycle
 * seam moves to its own module.
 */

import { initializeDatabase, closeDatabase } from '../../../db/client.js';

import { createLogger } from '../../../utils/logger.js';
const log = createLogger('postgres');

/**
 * Connection lifecycle for the PostgreSQL backend.
 */
class BasePostgresAdapter {
  async initialize() {
    await initializeDatabase();
    log.info('[PostgresAdapter] Connected to PostgreSQL');
  }

  async close() {
    await closeDatabase();
  }
}

/**
 * The PostgreSQL adapter — connection lifecycle only, now that every domain
 * reaches the database through direct Kysely.
 */
export const PostgresAdapter = BasePostgresAdapter;