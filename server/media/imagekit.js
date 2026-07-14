import crypto from 'node:crypto';
import { cleanStr } from '../../shared/string-utils.js';

function cleanFolder(v) {
  const s = cleanStr(v);
  if (!s) return '';
  // ImageKit uses folder paths like "/my-app". Normalize to leading slash.
  const withSlash = s.startsWith('/') ? s : `/${s}`;
  return withSlash.replace(/\/+$/, '');
}

export function getImageKitConfigFromEnv() {
  const privateKey = cleanStr(process.env.IMAGEKIT_PRIVATE_KEY);
  const publicKey = cleanStr(process.env.IMAGEKIT_PUBLIC_KEY);
  const urlEndpoint = cleanStr(process.env.IMAGEKIT_URL_ENDPOINT);
  const uploadFolder = cleanFolder(process.env.IMAGEKIT_UPLOAD_FOLDER);
  const tagPrefix = cleanStr(process.env.IMAGEKIT_TAG_PREFIX) || 'deck:';
  const metadataFieldAltSeed = cleanStr(process.env.IMAGEKIT_METADATA_FIELD_ALT_SEED);

  const issues = [];
  const warnings = [];

  if (!privateKey) issues.push('IMAGEKIT_PRIVATE_KEY is missing');
  if (!publicKey) issues.push('IMAGEKIT_PUBLIC_KEY is missing');
  if (!urlEndpoint) issues.push('IMAGEKIT_URL_ENDPOINT is missing');
  if (!uploadFolder) warnings.push('IMAGEKIT_UPLOAD_FOLDER is missing (uploads will use ImageKit defaults)');
  if (!metadataFieldAltSeed)
    warnings.push(
      'IMAGEKIT_METADATA_FIELD_ALT_SEED is missing (ALT seed read/write will be disabled)'
    );

  const configured = issues.length === 0;
  return {
    configured,
    issues,
    warnings,
    privateKey,
    publicKey,
    urlEndpoint,
    uploadFolder,
    tagPrefix,
    metadataFields: {
      altSeed: metadataFieldAltSeed,
    },
  };
}

function basicAuthHeader(privateKey) {
  const token = Buffer.from(`${privateKey}:`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function fetchJsonOrThrow(url, opts = {}) {
  const res = await fetch(url, opts);
  const ct = String(res.headers.get('content-type') || '');
  const isJson = ct.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');
  if (!res.ok) {
    const msg =
      typeof body === 'string'
        ? body
        : body && typeof body === 'object'
          ? JSON.stringify(body)
          : 'Request failed';
    const err = new Error(msg || `Request failed (${res.status})`);
    err.statusCode = res.status;
    err.details = body;
    throw err;
  }
  return body;
}

export function toImageKitSearchQuery({ q, searchQuery }) {
  const sq = cleanStr(searchQuery);
  if (sq) return sq;
  const term = cleanStr(q);
  if (!term) return '';
  // ImageKit searchable fields: name, tags, path, format, size, width, height,
  // createdAt, updatedAt, customMetadata.*, embeddedMetadata.*
  // Note: description is NOT searchable via the API.
  const escaped = term.replace(/"/g, '\\"');
  // name HAS and tags HAS both support partial, case-insensitive matching
  // For multi-select custom metadata (like People), IN requires exact match with case variations
  const lower = escaped.toLowerCase();
  const title = escaped.charAt(0).toUpperCase() + escaped.slice(1).toLowerCase();
  const variants = [...new Set([escaped, lower, title])];
  const peopleClause = `"customMetadata.People" IN [${variants.map((v) => `"${v}"`).join(',')}]`;
  return `(name HAS "${escaped}" OR tags HAS "${escaped}" OR ${peopleClause})`;
}

export async function listImageKitFiles({
  q,
  searchQuery,
  limit = 48,
  skip = 0,
} = {}) {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    const err = new Error('ImageKit is not configured');
    err.statusCode = 400;
    throw err;
  }

  const sq = toImageKitSearchQuery({ q, searchQuery });
  const u = new URL('https://api.imagekit.io/v1/files');
  if (sq) u.searchParams.set('searchQuery', sq);
  u.searchParams.set('limit', String(Math.max(1, Math.min(100, Number(limit) || 48))));
  u.searchParams.set('skip', String(Math.max(0, Number(skip) || 0)));
  // Include custom metadata (for ALT text) in response
  u.searchParams.set('includeCustomMetadata', 'true');

  return await fetchJsonOrThrow(u.toString(), {
    method: 'GET',
    headers: {
      Authorization: basicAuthHeader(cfg.privateKey),
    },
  });
}

/**
 * Fetch all unique tags from ImageKit by sampling files.
 * ImageKit doesn't have a dedicated tags endpoint, so we aggregate from file listings.
 * @returns {Promise<Array<{tag: string, count: number}>>} - Sorted by count (descending)
 */
export async function listImageKitTags() {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    const err = new Error('ImageKit is not configured');
    err.statusCode = 400;
    throw err;
  }

  // Fetch multiple batches to get a good sample of tags
  const batchSize = 100;
  const batches = 5; // 500 files total
  const tagCounts = new Map();

  for (let i = 0; i < batches; i++) {
    try {
      const u = new URL('https://api.imagekit.io/v1/files');
      u.searchParams.set('limit', String(batchSize));
      u.searchParams.set('skip', String(i * batchSize));

      const files = await fetchJsonOrThrow(u.toString(), {
        method: 'GET',
        headers: {
          Authorization: basicAuthHeader(cfg.privateKey),
        },
      });

      if (!Array.isArray(files) || files.length === 0) break;

      for (const file of files) {
        const tags = Array.isArray(file?.tags) ? file.tags : [];
        for (const tag of tags) {
          const t = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
          if (t) {
            tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
          }
        }
      }

      // Stop if we got fewer files than requested (end of list)
      if (files.length < batchSize) break;
    } catch {
      // Continue with what we have if a batch fails
      break;
    }
  }

  // Sort by count (descending), then alphabetically
  return Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * Fetch details for a single file from ImageKit.
 * This returns full metadata including customMetadata that may not be in list results.
 * @param {string} fileId - The file ID
 * @returns {Promise<object>} - File details
 */
export async function getImageKitFileDetails(fileId) {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    const err = new Error('ImageKit is not configured');
    err.statusCode = 400;
    throw err;
  }
  const id = cleanStr(fileId);
  if (!id) {
    const err = new Error('fileId is required');
    err.statusCode = 400;
    throw err;
  }
  const u = `https://api.imagekit.io/v1/files/${encodeURIComponent(id)}/details`;
  return await fetchJsonOrThrow(u, {
    method: 'GET',
    headers: {
      Authorization: basicAuthHeader(cfg.privateKey),
    },
  });
}

export async function patchImageKitFileDetails(fileId, patch = {}) {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    const err = new Error('ImageKit is not configured');
    err.statusCode = 400;
    throw err;
  }
  const id = cleanStr(fileId);
  if (!id) {
    const err = new Error('fileId is required');
    err.statusCode = 400;
    throw err;
  }
  const u = `https://api.imagekit.io/v1/files/${encodeURIComponent(id)}/details`;
  return await fetchJsonOrThrow(u, {
    method: 'PATCH',
    headers: {
      Authorization: basicAuthHeader(cfg.privateKey),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(patch || {}),
  });
}

export function createImageKitUploadAuth({ ttlSeconds = 45 * 60 } = {}) {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    const err = new Error('ImageKit is not configured');
    err.statusCode = 400;
    throw err;
  }

  const token = crypto.randomBytes(24).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expire = now + Math.max(60, Math.min(55 * 60, Number(ttlSeconds) || 45 * 60));

  // ImageKit: signature = HMAC-SHA1(token + expire, privateKey) in lowercase hex
  const signature = crypto
    .createHmac('sha1', cfg.privateKey)
    .update(`${token}${expire}`)
    .digest('hex')
    .toLowerCase();

  return {
    publicKey: cfg.publicKey,
    token,
    expire,
    signature,
    uploadFolder: cfg.uploadFolder,
  };
}

export async function ingestImageKitRemoteUrl({
  url,
  fileName = '',
  folder = '',
  tags = null,
  customMetadata = null,
} = {}) {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    const err = new Error('ImageKit is not configured');
    err.statusCode = 400;
    throw err;
  }
  const remoteUrl = cleanStr(url);
  if (!remoteUrl) {
    const err = new Error('url is required');
    err.statusCode = 400;
    throw err;
  }

  const form = new FormData();
  form.append('file', remoteUrl);
  if (cleanStr(fileName)) form.append('fileName', cleanStr(fileName));
  if (cleanStr(folder)) form.append('folder', cleanFolder(folder));
  if (Array.isArray(tags)) form.append('tags', tags.filter((t) => cleanStr(t)).join(','));
  if (customMetadata && typeof customMetadata === 'object')
    form.append('customMetadata', JSON.stringify(customMetadata));

  return await fetchJsonOrThrow('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(cfg.privateKey),
    },
    body: form,
  });
}

/**
 * Upload a file buffer directly to ImageKit (server-side upload).
 * @param {object} options - Upload options
 * @param {Buffer} options.buffer - The file buffer to upload
 * @param {string} options.fileName - The filename to use
 * @param {string} options.mimeType - The MIME type of the file (e.g., 'image/png')
 * @param {string} [options.folder] - Optional folder path
 * @param {string[]} [options.tags] - Optional tags
 * @param {object} [options.customMetadata] - Optional custom metadata
 * @returns {Promise<object>} - ImageKit upload response with url, fileId, etc.
 */
export async function uploadImageKitBuffer({
  buffer,
  fileName,
  mimeType,
  folder = '',
  tags = null,
  customMetadata = null,
} = {}) {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    const err = new Error('ImageKit is not configured');
    err.statusCode = 400;
    throw err;
  }

  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error('buffer is required and must be a Buffer');
    err.statusCode = 400;
    throw err;
  }

  if (!cleanStr(fileName)) {
    const err = new Error('fileName is required');
    err.statusCode = 400;
    throw err;
  }

  // Convert buffer to base64 data URL for ImageKit upload API
  const base64Data = buffer.toString('base64');
  const dataUrl = `data:${mimeType || 'application/octet-stream'};base64,${base64Data}`;

  const form = new FormData();
  form.append('file', dataUrl);
  form.append('fileName', cleanStr(fileName));

  // Use configured upload folder if no folder specified
  const uploadFolder = cleanStr(folder) || cfg.uploadFolder;
  if (uploadFolder) form.append('folder', cleanFolder(uploadFolder));

  if (Array.isArray(tags)) form.append('tags', tags.filter((t) => cleanStr(t)).join(','));
  if (customMetadata && typeof customMetadata === 'object')
    form.append('customMetadata', JSON.stringify(customMetadata));

  return await fetchJsonOrThrow('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(cfg.privateKey),
    },
    body: form,
  });
}

/**
 * Upload an image from a URL to ImageKit.
 * Fetches the image and uploads it to ImageKit.
 * @param {string} imageUrl - The URL of the image to upload
 * @param {string} fileName - The filename to use
 * @param {object} options - Additional options
 * @param {string} [options.folder] - Optional folder path
 * @param {string[]} [options.tags] - Optional tags
 * @returns {Promise<string>} - The uploaded image URL
 */
export async function uploadImageKitUrl(imageUrl, fileName, options = {}) {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    console.log('[ImageKit] Not configured, returning original URL');
    return imageUrl;
  }

  if (!imageUrl) {
    throw new Error('imageUrl is required');
  }

  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    // Get the buffer and mime type
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Upload to ImageKit
    const result = await uploadImageKitBuffer({
      buffer,
      fileName: cleanStr(fileName) || 'image.jpg',
      mimeType: contentType,
      folder: options.folder || '',
      tags: options.tags || null,
    });

    return result?.url || imageUrl;
  } catch (e) {
    console.error(`[ImageKit] Failed to upload from URL: ${e.message}`);
    // Return original URL as fallback
    return imageUrl;
  }
}