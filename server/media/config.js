/**
 * Media storage configuration.
 * Reads from environment variables to determine which provider to use.
 */

/**
 * Get the media storage mode.
 * - 'auto' - Use Scaleway if configured, otherwise local
 * - 'scaleway' - Force Scaleway (fails if not configured)
 * - 'local' - Force local /uploads storage
 * @returns {'auto' | 'scaleway' | 'local'}
 */
export function getMediaStorageMode() {
  const mode = (process.env.MEDIA_STORAGE_MODE || '').toLowerCase().trim();
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
    process.env.SCW_ACCESS_KEY &&
    process.env.SCW_SECRET_KEY &&
    process.env.SCW_BUCKET
  );
}

/**
 * Get Scaleway Object Storage configuration.
 * Uses SCW_ prefix to match Scaleway's standard env var naming.
 * @returns {{ accessKeyId: string, secretAccessKey: string, region: string, bucket: string, endpoint: string, cdnUrl: string | null }}
 */
export function getScalewayConfig() {
  const region = process.env.SCW_REGION || 'nl-ams';
  return {
    accessKeyId: process.env.SCW_ACCESS_KEY || '',
    secretAccessKey: process.env.SCW_SECRET_KEY || '',
    region,
    bucket: process.env.SCW_BUCKET || '',
    // Scaleway S3-compatible endpoint
    endpoint: process.env.SCW_ENDPOINT || `https://s3.${region}.scw.cloud`,
    // Optional CDN URL for public access (if using Scaleway Edge Services or custom domain)
    cdnUrl: process.env.SCW_CDN_URL || null,
  };
}

/**
 * Get the local uploads directory path.
 * @param {string} repoRoot
 * @returns {string}
 */
export function getLocalUploadsDir(repoRoot) {
  if (process.env.UPLOADS_DIR) {
    // If absolute path, use as-is; otherwise resolve relative to repo root
    const dir = process.env.UPLOADS_DIR;
    if (dir.startsWith('/')) return dir;
    return `${repoRoot}/${dir}`;
  }
  return `${repoRoot}/server/uploads`;
}

/**
 * Get the public URL prefix for local uploads.
 * @returns {string}
 */
export function getLocalUploadsUrlPrefix() {
  return process.env.UPLOADS_URL_PREFIX || '/uploads';
}

/**
 * Get the effective media provider type to use.
 * @returns {'scaleway' | 'local'}
 */
export function getEffectiveMediaProvider() {
  const mode = getMediaStorageMode();

  if (mode === 'scaleway') {
    if (!isScalewayConfigured()) {
      throw new Error('MEDIA_STORAGE_MODE=scaleway but Scaleway is not configured');
    }
    return 'scaleway';
  }

  if (mode === 'local') {
    return 'local';
  }

  // auto mode: use Scaleway if configured, otherwise local
  return isScalewayConfigured() ? 'scaleway' : 'local';
}