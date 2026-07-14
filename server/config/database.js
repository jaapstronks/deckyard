/**
 * Database configuration for PostgreSQL.
 * Used when STORAGE_MODE=postgres
 */

export function getStorageMode() {
  const mode = (process.env.STORAGE_MODE || '').toLowerCase().trim();
  if (mode === 'postgres' || mode === 'postgresql') {
    return 'postgres';
  }
  return 'file'; // default for OSS self-hosted
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

/**
 * Dual-write mode for safe migration:
 * - 'off' - No dual-write (default)
 * - 'shadow' - Write both, read file, compare results
 * - 'primary-file' - Write both, read from file
 * - 'primary-postgres' - Write both, read from postgres
 */
export function getDualWriteMode() {
  const mode = (process.env.DUAL_WRITE_MODE || '').toLowerCase().trim();
  if (['shadow', 'primary-file', 'primary-postgres'].includes(mode)) {
    return mode;
  }
  return 'off';
}