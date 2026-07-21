/**
 * Image upload for theme assets.
 *
 * Two paths, chosen by what the install's media provider supports: a presigned
 * PUT straight to object storage (Scaleway/S3), or a data-URL round-trip
 * through the server (local disk). Extracted from the logo uploader so the
 * background-preset editor uploads the same way rather than growing a second
 * copy that drifts.
 */

import { api } from '../../../lib/api.js';

/** Read a File as a data URL. */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Upload an image and return its public URL.
 * @param {File} file
 * @returns {Promise<{url: string}>}
 */
export async function uploadImage(file) {
  let mediaStatus;
  try {
    mediaStatus = await api('/api/media/status');
  } catch {
    // An unreachable status endpoint just means we take the server-side path.
    mediaStatus = { presignedSupported: false };
  }

  if (mediaStatus.presignedSupported) {
    const presign = await api('/api/media/presign', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
    });

    const uploadResp = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: presign.headers || {},
      body: file,
    });
    if (!uploadResp.ok) {
      throw new Error(`Upload failed: ${uploadResp.status}`);
    }

    const confirm = await api('/api/media/confirm', {
      method: 'POST',
      body: JSON.stringify({ key: presign.key }),
    });
    return { url: confirm.publicUrl };
  }

  const dataUrl = await readFileAsDataUrl(file);
  const saved = await api('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ dataUrl, originalName: file.name }),
  });
  return { url: saved.url };
}
