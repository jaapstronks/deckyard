/**
 * Database configuration for PostgreSQL.
 * Used when STORAGE_MODE=postgres
 */

import { envBool } from './utils.js';

/**
 * The only accepted value of STORAGE_MODE. PostgreSQL is the sole storage
 * backend; disk-JSON storage was removed during beta (see
 * docs/reference/versioning.md § the beta stance). One canonical spelling:
 * `postgresql` is not an alias for `postgres`, it is a boot error.
 * @type {readonly ['postgres']}
 */
export const STORAGE_MODES = Object.freeze(['postgres']);

/** Storage backend used when STORAGE_MODE is unset. */
export const DEFAULT_STORAGE_MODE = 'postgres';

/**
 * The configured storage backend.
 *
 * Anything outside {@link STORAGE_MODES} is rejected at boot by
 * {@link storageModeError}, so a booted process never reaches this with an
 * unknown value. The fallback exists for callers that skip the boot guard
 * (scripts, tests) and deliberately resolves to the default.
 *
 * @returns {'postgres'}
 */
export function getStorageMode() {
  const mode = (process.env.STORAGE_MODE || '').trim();
  if (!mode) return DEFAULT_STORAGE_MODE;
  return STORAGE_MODES.includes(mode) ? mode : DEFAULT_STORAGE_MODE;
}

/**
 * Validate STORAGE_MODE, for the boot guard in server.js.
 *
 * Matching is exact and case-sensitive: one spelling per backend keeps the
 * value comparable across .env files, compose files and docs.
 *
 * @returns {string|null} Error message, or null when the value is valid.
 */
export function storageModeError() {
  const raw = (process.env.STORAGE_MODE || '').trim();
  if (!raw || STORAGE_MODES.includes(raw)) return null;

  if (raw === 'file') {
    return (
      'STORAGE_MODE="file" is no longer supported: disk-JSON storage was ' +
      'removed in 1.x. Run `npm run db:import` once against your existing ' +
      'data directory to move it into PostgreSQL, then remove STORAGE_MODE ' +
      'from your environment (unset means "postgres").'
    );
  }
  const hint =
    raw.toLowerCase() === 'postgresql'
      ? 'The canonical spelling is "postgres"; "postgresql" is no longer accepted. '
      : '';
  return (
    `STORAGE_MODE="${raw}" is not a valid storage mode. ${hint}` +
    `Use one of: ${STORAGE_MODES.map((m) => `"${m}"`).join(', ')} ` +
    `(unset means "${DEFAULT_STORAGE_MODE}").`
  );
}

export function isPostgresMode() {
  return getStorageMode() === 'postgres';
}

/**
 * SSL settings for a connection, derived the same way regardless of whether the
 * host came from `DATABASE_HOST` or a parsed `DATABASE_URL`.
 *
 * SSL is on by default for a non-localhost host; `DATABASE_SSL=false` forces it
 * off (e.g. an internal network), and `DATABASE_SSL_REJECT_UNAUTHORIZED=false`
 * allows self-signed certificates (managed database services).
 *
 * @param {string} host
 * @returns {{ rejectUnauthorized: boolean } | false}
 */
function resolveSsl(host) {
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  // DATABASE_SSL defaults to on (absent = SSL) — only an explicit false
  // value may disable it, so the default lives in the envBool fallback.
  const sslEnabled = !isLocalhost && envBool('DATABASE_SSL', true);
  const rejectUnauthorized = envBool('DATABASE_SSL_REJECT_UNAUTHORIZED', true);
  return sslEnabled ? { rejectUnauthorized } : false;
}

function poolConfig() {
  return {
    min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  };
}

/**
 * Connection config, either parsed from `DATABASE_URL` or assembled from the
 * discrete `DATABASE_*` variables.
 *
 * `DATABASE_URL`, when set, is the **complete** override: every connection field
 * (host, port, database, user, password) comes from the URL, not from a mix of
 * URL and `DATABASE_*`. This is the one connection knob the whole stack agrees
 * on — the app pool ({@link initializeDatabase}), the migration runner
 * (`db:migrate`) and the data importer all read this function, so pointing
 * `DATABASE_URL` at a scratch database migrates and serves *that* database
 * instead of whatever `.env`'s `DATABASE_HOST`/`DATABASE_NAME` names. That
 * matters for the `test:pg` recipe: its scratch DB is expressed as `DATABASE_URL`,
 * and before this a bare `db:migrate` ignored it and migrated the dev database.
 * The SSL and pool knobs (`DATABASE_SSL*`, `DATABASE_POOL_*`) still apply on top,
 * since a URL does not carry them.
 *
 * @returns {{ host: string, port: number, database: string, user: string, password: string, ssl: { rejectUnauthorized: boolean } | false, pool: { min: number, max: number } }}
 */
export function getDatabaseConfig() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(
        'DATABASE_URL is set but is not a valid connection URL ' +
          '(expected e.g. postgres://user:pass@host:5432/dbname).',
      );
    }
    const host = parsed.hostname || 'localhost';
    return {
      host,
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      database:
        decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'deckyard',
      user: decodeURIComponent(parsed.username) || 'deckyard',
      password: decodeURIComponent(parsed.password) || '',
      ssl: resolveSsl(host),
      pool: poolConfig(),
    };
  }

  const host = process.env.DATABASE_HOST || 'localhost';
  return {
    host,
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'deckyard',
    user: process.env.DATABASE_USER || 'deckyard',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: resolveSsl(host),
    pool: poolConfig(),
  };
}

/**
 * Default organization ID for single-tenant OSS deployments.
 * In multi-tenant SaaS mode, this is used only as a fallback.
 */
export function getDefaultOrganizationId() {
  return (
    process.env.DEFAULT_ORGANIZATION_ID ||
    '00000000-0000-0000-0000-000000000001'
  );
}
