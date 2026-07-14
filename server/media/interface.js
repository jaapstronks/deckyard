/**
 * MediaProvider interface.
 * Base class defining the contract for media storage providers.
 */

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
   * @param {{ buffer: Buffer, filename: string, contentType: string }} opts
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