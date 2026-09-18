/** SSRF-guarded image copy through the configured media provider. */
import { getMediaProvider, isMediaProviderInitialized } from './index.js';
import { safeFetchRemoteImage } from '../utils/ssrf-guard.js';

/** Maximum size for remote image copies. */
export const REHOST_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Fetch a remote image and store it through the active media provider.
 *
 * @param {Object} args
 * @param {string} args.url - remote image URL to copy
 * @param {string} args.filename - base name for the stored object (no extension)
 * @param {number} [args.maxBytes] - byte ceiling, default {@link REHOST_MAX_BYTES}
 * @returns {Promise<{publicUrl: string, key: string, contentType: string, size: number}>}
 * @throws {Error} when no provider is initialized, the fetch is blocked or
 *   fails, or the provider refuses the bytes (type/size).
 */
export async function rehostRemoteImage({
  url,
  filename,
  maxBytes = REHOST_MAX_BYTES,
}) {
  if (!isMediaProviderInitialized()) {
    throw new Error('Media provider not initialized');
  }

  const fetched = await safeFetchRemoteImage(url, { maxBytes });
  if (!fetched) {
    throw new Error('Blocked or failed to fetch image');
  }

  // Preserve the Notion importer's fallback for missing image content types.
  const contentType =
    fetched.contentType === 'application/octet-stream'
      ? 'image/jpeg'
      : fetched.contentType;

  const result = await getMediaProvider().uploadBuffer({
    buffer: fetched.buffer,
    filename,
    contentType,
    maxBytes,
  });

  return {
    publicUrl: result.publicUrl,
    key: result.key,
    contentType: result.contentType || contentType,
    size: result.size,
  };
}
