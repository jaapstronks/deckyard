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

/** `code` on the error thrown for an unparseable `DATABASE_URL`. */
const DATABASE_URL_INVALID = 'DECKYARD_DATABASE_URL_INVALID';

/**
 * Error codes that mean "Deckyard never got a usable connection": the socket,
 * the credentials, the database name, or the URL that describes them. Every one
 * of these is the operator's environment to fix.
 *
 * Deliberately not a catch-all. A migration that throws `42P07`, or any error
 * without a code, is a Deckyard problem and keeps its stack trace — dressing
 * that up as "cannot reach PostgreSQL" would send the reader to the wrong place.
 * @type {ReadonlySet<string>}
 */
const CONNECTION_ERROR_CODES = new Set([
  // Socket level.
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // PostgreSQL answered, but not with a session.
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '28000', // invalid_authorization_specification
  '28P01', // invalid_password
  '3D000', // invalid_catalog_name — no such database
  '57P03', // cannot_connect_now — still starting up
  DATABASE_URL_INVALID,
]);

/**
 * The one connection failure pg raises client-side, before a code exists: the
 * server asked for SCRAM and the config carries no password. Matched on the
 * driver's own fixed string because there is nothing else to match on.
 *
 * This is the likeliest failure of a fresh Node install that *does* have a
 * PostgreSQL: `scripts/install.sh` writes a minimal `.env` with no
 * `DATABASE_PASSWORD`, so the default connection reaches a real server and then
 * cannot authenticate.
 */
const MISSING_PASSWORD = /client password must be a string/i;

/**
 * Whether this error means the database was never reached.
 * @param {any} err
 * @returns {boolean}
 */
export function isDatabaseConnectionError(err) {
  if (CONNECTION_ERROR_CODES.has(String(err?.code || ''))) return true;
  return MISSING_PASSWORD.test(String(err?.message || ''));
}

/**
 * Turn a failed connection attempt into the sentence an operator can act on.
 *
 * One message for the whole stack: the boot guard in server.js and the
 * migration runner (`db:migrate`) both fail on the same three causes a fresh
 * install hits, and both used to answer with a raw `AggregateError` stack from
 * pg-pool whose own `message` is the empty string. PostgreSQL is the only
 * storage backend ({@link STORAGE_MODES}), so there is nothing to fall back to
 * and nothing to soften: name the target, name the cause, name the fix.
 *
 * @param {any} err - The error thrown while connecting.
 * @returns {string} Error message, for a `⚠️  DATABASE:` boot refusal.
 */
export function databaseConnectionError(err) {
  // An unparseable DATABASE_URL fails before any socket is opened, and
  // getDatabaseConfig() has already said so in a full sentence. Asking it for a
  // connection target here would throw a second time, inside the error path.
  let config;
  try {
    config = getDatabaseConfig();
  } catch (configErr) {
    return String(configErr?.message || configErr);
  }

  const target = `${config.user}@${config.host}:${config.port}/${config.database}`;
  const code = String(err?.code || '');
  const detail = String(err?.message || '').trim();

  // 3D000 / 28P01 mean the server answered: it is running and reachable, so the
  // fix is a database or a credential, not an installation.
  if (code === '3D000') {
    return (
      `PostgreSQL at ${target} is reachable, but that database does not exist.\n` +
      `  Create it:  createdb -h ${config.host} -U ${config.user} ${config.database}\n` +
      `  Or point DATABASE_URL / DATABASE_NAME in .env at an existing database.\n` +
      `Then apply the schema:  npm run db:migrate`
    );
  }
  if (MISSING_PASSWORD.test(detail)) {
    return (
      `PostgreSQL at ${target} asked for a password, and none is configured.\n` +
      `  Set one in .env:  DATABASE_PASSWORD=…\n` +
      `  Or give the whole connection at once:  DATABASE_URL=postgres://user:password@host:5432/dbname\n` +
      `A fresh install writes a minimal .env without database settings, so this is the usual first stop.`
    );
  }
  if (code === '28P01' || code === '28000') {
    return (
      `PostgreSQL at ${target} refused the credentials.\n` +
      `  Check DATABASE_USER and DATABASE_PASSWORD in .env (or the user:password in DATABASE_URL).`
    );
  }

  const cause = code
    ? `${code}${detail ? `: ${detail}` : ''}`
    : detail || 'unknown error';
  return (
    `Cannot reach PostgreSQL at ${target} (${cause}).\n` +
    `PostgreSQL is the only storage backend — there is no file-storage mode to fall back on — so Deckyard stops here.\n` +
    `Bring a database up, then point .env at it and apply the schema:\n` +
    `  1. A throwaway local one, if you have Docker:\n` +
    `       docker run -d --name deckyard-pg -p 5432:5432 \\\n` +
    `         -e POSTGRES_USER=deckyard -e POSTGRES_PASSWORD=deckyard -e POSTGRES_DB=deckyard postgres:16\n` +
    `     Or install PostgreSQL 14+ and create that role and database yourself.\n` +
    `  2. In .env:  DATABASE_URL=postgres://deckyard:deckyard@localhost:5432/deckyard\n` +
    `  3. npm run db:migrate\n` +
    `Not what you wanted? \`docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build\` brings its own database (README § Quick Start).`
  );
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
      const err = new Error(
        'DATABASE_URL is set but is not a valid connection URL ' +
          '(expected e.g. postgres://user:pass@host:5432/dbname).',
      );
      // Carries a code so the boot guard and `db:migrate` classify it the same
      // way as a refused socket: an operator's env to fix, not a Deckyard bug.
      err.code = DATABASE_URL_INVALID;
      throw err;
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
