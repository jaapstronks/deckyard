/**
 * Media storage configuration.
 *
 * The remote provider is a generic **S3-compatible** one (`S3_*`), not a
 * Scaleway-specific one: Scaleway, MinIO, Wasabi, Backblaze B2 and AWS S3 all
 * speak the same API, and naming the seam after one vendor was the drift D25
 * closes. `S3_ENDPOINT` is therefore required in `s3` mode — there is no
 * vendor default to fall back to.
 *
 * The old `SCW_*` names and `MEDIA_STORAGE_MODE=scaleway` are still read until
 * the removal date, but only when their `S3_*` counterpart is unset, and every
 * legacy name that is read produces a boot warning (see
 * {@link mediaConfigWarnings}) — the B68 shape, not a silent alias.
 */

import { envStr } from '../config/utils.js';

/**
 * Legacy Scaleway-era spellings, recognized until the removal date. Maps the
 * old var → its canonical `S3_*` replacement.
 */
const LEGACY_MEDIA_VARS = Object.freeze({
  SCW_ACCESS_KEY: 'S3_ACCESS_KEY',
  SCW_SECRET_KEY: 'S3_SECRET_KEY',
  SCW_BUCKET: 'S3_BUCKET',
  SCW_REGION: 'S3_REGION',
  SCW_ENDPOINT: 'S3_ENDPOINT',
  SCW_CDN_URL: 'S3_PUBLIC_URL',
});

/** Date after which the `SCW_*` names and `scaleway` mode stop being read. */
const LEGACY_MEDIA_REMOVAL_DATE = '2026-11-01';

/** Region assumed when neither `S3_REGION` nor the legacy `SCW_REGION` is set. */
const DEFAULT_REGION = 'nl-ams';

/**
 * Read `name`, falling back to its legacy spelling when `name` is unset.
 * @param {string} name - Canonical `S3_*` var.
 * @param {string} legacyName - Deprecated `SCW_*` var.
 * @returns {string}
 */
function envWithLegacy(name, legacyName) {
  const value = envStr(name);
  if (value) return value;
  return envStr(legacyName);
}

/**
 * Get the media storage mode.
 * - `auto` — S3 when it is fully configured, local otherwise
 * - `s3` — force S3 (fails when it is not configured)
 * - `local` — force local `/uploads` storage
 *
 * `scaleway` is the deprecated spelling of `s3`.
 * @returns {'auto' | 's3' | 'local'}
 */
function getMediaStorageMode() {
  const mode = envStr('MEDIA_STORAGE_MODE').toLowerCase();
  if (mode === 's3' || mode === 'scaleway') return 's3';
  if (mode === 'local') return 'local';
  return 'auto';
}

/**
 * Resolve the S3 endpoint.
 *
 * Canonical form: `S3_ENDPOINT`, no default. Legacy form: `SCW_ENDPOINT`, or —
 * and this is the only place a Scaleway host is still hard-coded — derived
 * from `SCW_REGION` the way the old code did, so an existing Scaleway install
 * keeps booting untouched.
 * @returns {string} Endpoint URL, or '' when nothing resolves.
 */
function resolveEndpoint() {
  const explicit = envStr('S3_ENDPOINT') || envStr('SCW_ENDPOINT');
  if (explicit) return explicit;
  // Legacy-only derivation: the pre-D25 default for a Scaleway bucket.
  if (envStr('SCW_BUCKET') || envStr('SCW_ACCESS_KEY')) {
    return `https://s3.${envStr('SCW_REGION', DEFAULT_REGION)}.scw.cloud`;
  }
  return '';
}

/**
 * Is the S3-compatible object storage fully configured?
 *
 * Complete means: credentials, a bucket, and an endpoint (which the legacy
 * branch may derive). Anything less and `auto` mode stays on local storage.
 * @returns {boolean}
 */
export function isS3Configured() {
  return !!(
    envWithLegacy('S3_ACCESS_KEY', 'SCW_ACCESS_KEY') &&
    envWithLegacy('S3_SECRET_KEY', 'SCW_SECRET_KEY') &&
    envWithLegacy('S3_BUCKET', 'SCW_BUCKET') &&
    resolveEndpoint()
  );
}

/**
 * Derive the public base URL for a bucket from its endpoint.
 *
 * Virtual-hosted style (`https://<bucket>.<endpoint-host>`), which is what the
 * provider signs with (`forcePathStyle: false`). Used when `S3_PUBLIC_URL` is
 * not set; the bucket must then be publicly readable.
 * @param {string} endpoint - Endpoint URL, with or without a trailing slash.
 * @param {string} bucket - Bucket name.
 * @returns {string} Base URL without a trailing slash, or '' when unresolvable.
 */
export function derivePublicBaseUrl(endpoint, bucket) {
  const raw = String(endpoint || '').trim();
  const name = String(bucket || '').trim();
  if (!raw || !name) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  return `${url.protocol}//${name}.${url.host}`;
}

/**
 * Get the S3-compatible object storage configuration.
 * @returns {{ accessKeyId: string, secretAccessKey: string, region: string, bucket: string, endpoint: string, publicUrl: string }}
 */
export function getS3Config() {
  const endpoint = resolveEndpoint();
  const bucket = envWithLegacy('S3_BUCKET', 'SCW_BUCKET');
  const explicitPublic = envWithLegacy('S3_PUBLIC_URL', 'SCW_CDN_URL');
  return {
    accessKeyId: envWithLegacy('S3_ACCESS_KEY', 'SCW_ACCESS_KEY'),
    secretAccessKey: envWithLegacy('S3_SECRET_KEY', 'SCW_SECRET_KEY'),
    region: envWithLegacy('S3_REGION', 'SCW_REGION') || DEFAULT_REGION,
    bucket,
    endpoint,
    publicUrl:
      (explicitPublic || derivePublicBaseUrl(endpoint, bucket)).replace(
        /\/$/,
        '',
      ) || '',
  };
}

/**
 * Get the effective media provider type to use.
 * @returns {'s3' | 'local'}
 * @throws {Error} When `s3` mode is forced but the configuration is incomplete.
 */
export function getEffectiveMediaProvider() {
  const mode = getMediaStorageMode();

  if (mode === 's3') {
    if (!isS3Configured()) {
      throw new Error(
        'MEDIA_STORAGE_MODE=s3 requires S3_ACCESS_KEY, S3_SECRET_KEY, ' +
          'S3_BUCKET and S3_ENDPOINT (no endpoint default — name your ' +
          'provider, e.g. https://s3.nl-ams.scw.cloud).',
      );
    }
    return 's3';
  }

  if (mode === 'local') {
    return 'local';
  }

  // auto mode: use S3 when it is fully configured, otherwise local
  return isS3Configured() ? 's3' : 'local';
}

/**
 * Non-fatal boot warnings for the deprecated Scaleway-era spellings.
 *
 * One line per legacy var that is actually read, plus one for the legacy mode
 * value. Returns [] on a clean `S3_*` configuration.
 * @returns {string[]}
 */
export function mediaConfigWarnings() {
  const warnings = [];

  if (envStr('MEDIA_STORAGE_MODE').toLowerCase() === 'scaleway') {
    warnings.push(
      `MEDIA_STORAGE_MODE=scaleway is deprecated and will be removed in the ` +
        `first release after ${LEGACY_MEDIA_REMOVAL_DATE}; set ` +
        `MEDIA_STORAGE_MODE=s3 instead.`,
    );
  }

  for (const [legacyName, name] of Object.entries(LEGACY_MEDIA_VARS)) {
    if (!envStr(legacyName)) continue;
    const overridden = envStr(name)
      ? ` (${name} is also set and takes precedence)`
      : '';
    warnings.push(
      `${legacyName} is deprecated and will be removed in the first release ` +
        `after ${LEGACY_MEDIA_REMOVAL_DATE}; set ${name} instead${overridden}.`,
    );
  }

  if (
    !envStr('S3_ENDPOINT') &&
    !envStr('SCW_ENDPOINT') &&
    (envStr('SCW_BUCKET') || envStr('SCW_ACCESS_KEY'))
  ) {
    warnings.push(
      `The S3 endpoint is being derived from SCW_REGION ` +
        `(${resolveEndpoint()}); that fallback disappears in the first ` +
        `release after ${LEGACY_MEDIA_REMOVAL_DATE}. Set S3_ENDPOINT.`,
    );
  }

  return warnings;
}
