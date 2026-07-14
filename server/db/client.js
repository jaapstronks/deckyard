/**
 * PostgreSQL client using Kysely for type-safe queries.
 * Initialize with initializeDatabase() before use.
 */

import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { getDatabaseConfig, isPostgresMode } from '../config/database.js';

const { Pool } = pg;

/** @type {Kysely<Database> | null} */
let db = null;

/** @type {pg.Pool | null} */
let pool = null;

/**
 * @typedef {Object} Database
 * @property {OrganizationsTable} organizations
 * @property {UsersTable} users
 * @property {PresentationsTable} presentations
 * @property {PresentationVersionsTable} presentation_versions
 * @property {PublishedPresentationsTable} published_presentations
 * @property {ImageLibraryTable} image_library
 * @property {SlideLibraryTable} slide_library
 * @property {FollowCodesTable} follow_codes
 * @property {AppSettingsTable} app_settings
 * @property {PresentSessionsTable} present_sessions
 * @property {InteractionsTable} interactions
 * @property {InteractionVotesTable} interaction_votes
 * @property {QuestionsTable} questions
 * @property {FeedbackTable} feedback
 */

/**
 * Initialize the database connection pool.
 * Only initializes if STORAGE_MODE=postgres.
 * @returns {Promise<Kysely<Database> | null>}
 */
export async function initializeDatabase() {
  if (!isPostgresMode()) {
    console.log('[DB] Storage mode is file-based, skipping PostgreSQL initialization');
    return null;
  }

  if (db) {
    return db;
  }

  const config = getDatabaseConfig();
  console.log(`[DB] Connecting to PostgreSQL at ${config.host}:${config.port}/${config.database}`);

  pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    min: config.pool.min,
    max: config.pool.max,
  });

  // Test connection
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('[DB] PostgreSQL connection successful');
  } catch (err) {
    console.error('[DB] PostgreSQL connection failed:', err.message);
    throw err;
  }

  db = new Kysely({
    dialect: new PostgresDialect({
      pool,
    }),
  });

  return db;
}

/**
 * Get the Kysely database instance.
 * @returns {Kysely<Database>}
 * @throws {Error} If database not initialized
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first or check STORAGE_MODE.');
  }
  return db;
}

/**
 * Get the raw pg Pool for direct queries if needed.
 * @returns {pg.Pool}
 * @throws {Error} If database not initialized
 */
export function getPool() {
  if (!pool) {
    throw new Error('Database not initialized. Call initializeDatabase() first or check STORAGE_MODE.');
  }
  return pool;
}

/**
 * Check if database is initialized and available.
 * @returns {boolean}
 */
export function isDatabaseAvailable() {
  return db !== null;
}

/**
 * Close the database connection pool.
 * @returns {Promise<void>}
 */
export async function closeDatabase() {
  if (db) {
    await db.destroy();
    db = null;
    pool = null; // Pool is closed by db.destroy()
    console.log('[DB] Database connections closed');
  }
}

/**
 * Run a raw SQL query (for migrations or advanced use).
 * @param {string} query - SQL query
 * @param {any[]} params - Query parameters
 * @returns {Promise<any>}
 */
export async function rawQuery(query, params = []) {
  const p = getPool();
  const result = await p.query(query, params);
  return result;
}

/**
 * Execute a transaction.
 * @template T
 * @param {(trx: Kysely<Database>) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function transaction(callback) {
  const database = getDb();
  return database.transaction().execute(callback);
}

// Re-export sql for tagged template literals
export { sql };