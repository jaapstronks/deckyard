import { readFileAsDataUrl } from './file.js';

function confirmedUrl(url) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('Upload confirmation failed');
  }
  return { url };
}

/**
 * Upload an image through the installation's media provider.
 * Status failures use the local route for this attempt only. Upload failures
 * reject without retrying or starting an upload through a different provider.
 * @param {Function} api - Internal API transport
 * @param {File} file
 * @returns {Promise<{url: string}>} A confirmed, non-empty public URL
 */
export async function uploadFile(api, file) {
  // Read capabilities for each attempt: a failed status request must not pin
  // this page to local uploads, and installation changes apply immediately.
  let status;
  try {
    status = await api('/api/media/status');
  } catch {
    status = { presignedSupported: false };
  }

  if (status.presignedSupported) {
    // Presigned upload flow (S3-compatible object storage)
    const presign = await api('/api/media/presign', {
      method: 'POST',
      body: {
        filename: file.name,
        contentType: file.type,
        size: file.size,
      },
    });

    // Upload directly to storage provider
    // Presigned upload straight to external storage: not our /api/*
    // surface, and must not carry our credentials/JSON headers.
    // eslint-disable-next-line no-restricted-syntax
    const uploadResp = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: presign.headers || {},
      body: file,
    });

    if (!uploadResp.ok) {
      throw new Error(
        `Upload failed: ${uploadResp.status} ${uploadResp.statusText}`,
      );
    }

    // Confirm the upload completed
    const confirm = await api('/api/media/confirm', {
      method: 'POST',
      body: { key: presign.key },
    });

    if (!confirm.exists) {
      throw new Error('Upload confirmation failed');
    }

    return confirmedUrl(confirm.publicUrl);
  }

  // Fallback: server-side upload (local storage)
  const dataUrl = await readFileAsDataUrl(file);
  const saved = await api('/api/uploads', {
    method: 'POST',
    body: { dataUrl, originalName: file.name },
  });
  return confirmedUrl(saved.url);
}
