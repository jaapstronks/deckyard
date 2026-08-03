/**
 * Database configuration for PostgreSQL.
 * Used when STORAGE_MODE=postgres
 */

/**
 * The only accepted values of STORAGE_MODE. One canonical spelling per
 * backend: `postgresql` is not an alias for `postgres`, it is a boot error.
 * @type {readonly ['postgres', 'file']}
 */
export const STORAGE_MODES = Object.freeze(['postgres', 'file']);

/** Storage backend used when STORAGE_MODE is unset. */
export const DEFAULT_STORAGE_MODE = 'postgres';

/**
 * The configured storage backend.
 *
 * Anything outside {@link STORAGE_MODES} is rejected at boot by
 * {@link storageModeError}, so a booted process never reaches this with an
 * unknown value. The fallback exists for callers that skip the boot guard
 * (scripts, tests) and deliberately resolves to the default rather than to
 * file storage: a typo must never silently open a second, empty workspace.
 *
 * @returns {'postgres' | 'file'}
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

export function getDatabaseConfig() {
  // SSL is enabled by default for non-localhost connections
  const host = process.env.DATABASE_HOST || 'localhost';
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  const sslExplicitlyDisabled = process.env.DATABASE_SSL === 'false';
  const sslEnabled = !isLocalhost && !sslExplicitlyDisabled;
  // Allow self-signed certificates (e.g., managed database services)
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';

  return {
    host,
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'deckyard',
    user: process.env.DATABASE_USER || 'deckyard',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: sslEnabled
      ? { rejectUnauthorized }
      : false,
    pool: {
      min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
      max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
    },
  };
}

/**
 * Default organization ID for single-tenant OSS deployments.
 * In multi-tenant SaaS mode, this is used only as a fallback.
 */
export function getDefaultOrganizationId() {
  return process.env.DEFAULT_ORGANIZATION_ID || '00000000-0000-0000-0000-000000000001';
}