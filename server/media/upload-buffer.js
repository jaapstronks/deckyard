/**
 * Upload an image buffer an import produced, by the best available route.
 *
 * Shared by the two imports of an existing deck: as image slides
 * (`services/deck-images-import.js`, pad B) and as editable slides
 * (`services/deck-slides-import.js`, B752), which both turn pages or embedded
 * pictures into uploads before a slide can point at them.
 */

import { uploadImageKitBuffer, getImageKitConfigFromEnv } from './imagekit.js';
import { getMediaProvider, isMediaProviderInitialized } from './index.js';

/**
 * Upload an image buffer using the best available method:
 * 1. ImageKit (if configured) - preferred for managed image hosting
 * 2. Media provider (S3/local) - fallback
 * @param {object} options
 * @param {Buffer} options.buffer - Image buffer
 * @param {string} options.fileName - File name
 * @param {string} options.mimeType - MIME type
 * @param {string[]} [options.tags] - Optional tags
 * @returns {Promise<string>} - Uploaded image URL
 */
export async function uploadImageBuffer({
  buffer,
  fileName,
  mimeType,
  tags = [],
}) {
  // Try ImageKit first (consistent with existing PPTX import)
  const imagekitConfig = getImageKitConfigFromEnv();
  if (imagekitConfig.configured) {
    const result = await uploadImageKitBuffer({
      buffer,
      fileName,
      mimeType,
      tags,
    });
    return result?.url || '';
  }

  // Fall back to generic media provider (S3 or local)
  if (isMediaProviderInitialized()) {
    const provider = getMediaProvider();
    const result = await provider.uploadBuffer({
      buffer,
      filename: fileName,
      contentType: mimeType,
    });
    return result?.publicUrl || '';
  }

  throw new Error(
    'No media provider configured (neither ImageKit nor S3/local)',
  );
}
