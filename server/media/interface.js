/**
 * MediaProvider interface.
 * Base class defining the contract for media storage providers.
 */

/** Every private object's key starts with this; nothing else's does. */
export const PRIVATE_KEY_PREFIX = 'private/';

/**
 * The storage key of a private object: `private/<folder>/<name>`.
 * @param {string} folder - lowercase slug naming the consumer (e.g. `fonts`)
 * @param {string} name - a single path segment
 * @returns {string}
 */
export function privateKey(folder, name) {
  if (!/^[a-z0-9-]+$/.test(String(folder || ''))) {
    throw new Error(`Invalid private media folder: ${folder}`);
  }
  if (!name || /[/\\\0]/.test(name) || name === '.' || name === '..') {
    throw new Error('Invalid private media name');
  }
  return `${PRIVATE_KEY_PREFIX}${folder}/${name}`;
}

/**
 * @param {unknown} key
 * @returns {boolean}
 */
export function isPrivateKey(key) {
  return typeof key === 'string' && key.startsWith(PRIVATE_KEY_PREFIX);
}

export class MediaProvider {
  /**
   * Get provider status information.
   * @returns {{ name: string, configured: boolean, supportsPresigned: boolean }}
   */
  getStatus() {
    throw new Error('Not implemented');
  }

  /**
   * Create a presigned URL for direct client upload.
   * @param {{ filename: string, contentType: string, size?: number }} opts
   * @returns {Promise<{ uploadUrl: string, key: string, publicUrl: string, headers?: Record<string, string>, expiresAt: string }>}
   */
  async createPresignedUpload(opts) {
    throw new Error('Not implemented');
  }

  /**
   * Upload a file from a Buffer (server-side upload).
   * @param {{ buffer: Buffer, filename: string, contentType: string, maxBytes?: number }} opts
   *   `maxBytes` optionally overrides the provider's default size ceiling
   *   (used by the stock-media / deck-import path, which allows larger GIFs).
   * @returns {Promise<{ key: string, publicUrl: string }>}
   */
  async uploadBuffer(opts) {
    throw new Error('Not implemented');
  }

  /**
   * Upload a file from a data URL (server-side upload).
   * @param {{ dataUrl: string, filename: string }} opts
   * @returns {Promise<{ key: string, publicUrl: string }>}
   */
  async uploadDataUrl(opts) {
    throw new Error('Not implemented');
  }

  /**
   * Store a file as a *private* object: never reachable through a public
   * bucket, CDN or static root, only through {@link readFile} — which is how an
   * app route serves it. The key always starts with `private/<folder>/`.
   * See docs/reference/font-management.md § Private font variants.
   * @param {{ buffer: Buffer, filename: string, contentType: string, folder: string }} opts
   * @returns {Promise<{ key: string, size: number, contentType: string }>}
   */
  async uploadPrivateBuffer(opts) {
    throw new Error('Not implemented');
  }

  /**
   * Read a stored object's bytes by its storage key, public or private.
   * @param {string} key
   * @returns {Promise<Buffer|null>} null when there is no such object
   */
  async readFile(key) {
    throw new Error('Not implemented');
  }

  /**
   * Confirm that a presigned upload completed successfully.
   * @param {string} key - The storage key from createPresignedUpload
   * @returns {Promise<{ exists: boolean, publicUrl: string, size?: number }>}
   */
  async confirmUpload(key) {
    throw new Error('Not implemented');
  }

  /**
   * Delete a file by its storage key.
   * @param {string} key
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteFile(key) {
    throw new Error('Not implemented');
  }

  /**
   * Check if a URL belongs to this provider.
   * @param {string} url
   * @returns {boolean}
   */
  ownsUrl(url) {
    return false;
  }
}
