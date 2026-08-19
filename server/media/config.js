/**
 * Media storage configuration.
 * Reads from environment variables to determine which provider to use.
 */

import { envStr } from '../config/utils.js';

/**
 * Get the media storage mode.
 * - 'auto' - Use Scaleway if configured, otherwise local
 * - 'scaleway' - Force Scaleway (fails if not configured)
 * - 'local' - Force local /uploads storage
 * @returns {'auto' | 'scaleway' | 'local'}
 */
function getMediaStorageMode() {
  const mode = envStr('MEDIA_STORAGE_MODE').toLowerCase();
  if (mode === 'scaleway') return 'scaleway';
  if (mode === 'local') return 'local';
  return 'auto';
}

/**
 * Check if Scaleway Object Storage is configured.
 * Uses SCW_ prefix to match Scaleway's standard env var naming.
 * @returns {boolean}
 */
export function isScalewayConfigured() {
  return !!(
    envStr('SCW_ACCESS_KEY') &&
    envStr('SCW_SECRET_KEY') &&
    envStr('SCW_BUCKET')
  );
}

/**
 * Get Scaleway Object Storage configuration.
 * Uses SCW_ prefix to match Scaleway's standard env var naming.
 * @returns {{ accessKeyId: string, secretAccessKey: string, region: string, bucket: string, endpoint: string, cdnUrl: string | null }}
 */
export function getScalewayConfig() {
  const region = envStr('SCW_REGION', 'nl-ams');
  return {
    accessKeyId: envStr('SCW_ACCESS_KEY'),
    secretAccessKey: envStr('SCW_SECRET_KEY'),
    region,
    bucket: envStr('SCW_BUCKET'),
    // Scaleway S3-compatible endpoint
    endpoint: envStr('SCW_ENDPOINT', `https://s3.${region}.scw.cloud`),
    // Optional CDN URL for public access (if using Scaleway Edge Services or custom domain)
    cdnUrl: envStr('SCW_CDN_URL') || null,
  };
}

/**
 * Get the effective media provider type to use.
 * @returns {'scaleway' | 'local'}
 */
export function getEffectiveMediaProvider() {
  const mode = getMediaStorageMode();

  if (mode === 'scaleway') {
    if (!isScalewayConfigured()) {
      throw new Error(
        'MEDIA_STORAGE_MODE=scaleway but Scaleway is not configured',
      );
    }
    return 'scaleway';
  }

  if (mode === 'local') {
    return 'local';
  }

  // auto mode: use Scaleway if configured, otherwise local
  return isScalewayConfigured() ? 'scaleway' : 'local';
}
