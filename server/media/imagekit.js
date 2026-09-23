import { cleanStr } from '../../shared/string-utils.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { createLogger, logError } from '../utils/logger.js';
import { envStr } from '../config/utils.js';
import { safeFetchRemoteImage } from '../utils/ssrf-guard.js';

const log = createLogger('imagekit');

function cleanFolder(v) {
  const s = cleanStr(v);
  if (!s) return '';
  // ImageKit uses folder paths like "/my-app". Normalize to leading slash.
  const withSlash = s.startsWith('/') ? s : `/${s}`;
  return withSlash.replace(/\/+$/, '');
}

/** Comma-separated env value → trimmed, non-empty, de-duplicated list. */
function cleanList(v) {
  const s = cleanStr(v);
  if (!s) return [];
  return [
    ...new Set(
      s
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

export function getImageKitConfigFromEnv() {
  const privateKey = cleanStr(envStr('IMAGEKIT_PRIVATE_KEY'));
  const publicKey = cleanStr(envStr('IMAGEKIT_PUBLIC_KEY'));
  const urlEndpoint = cleanStr(envStr('IMAGEKIT_URL_ENDPOINT'));
  const uploadFolder = cleanFolder(envStr('IMAGEKIT_UPLOAD_FOLDER'));
  const tagPrefix = cleanStr(envStr('IMAGEKIT_TAG_PREFIX')) || 'deck:';
  const metadataFieldAltSeed = cleanStr(
    envStr('IMAGEKIT_METADATA_FIELD_ALT_SEED'),
  );
  const hiddenTags = cleanList(envStr('IMAGEKIT_HIDDEN_TAGS'));

  const issues = [];
  const warnings = [];

  if (!privateKey) issues.push('IMAGEKIT_PRIVATE_KEY is missing');
  if (!publicKey) issues.push('IMAGEKIT_PUBLIC_KEY is missing');
  if (!urlEndpoint) issues.push('IMAGEKIT_URL_ENDPOINT is missing');
  if (!uploadFolder)
    warnings.push(
      'IMAGEKIT_UPLOAD_FOLDER is missing (uploads will use ImageKit defaults)',
    );
  if (!metadataFieldAltSeed)
    warnings.push(
      'IMAGEKIT_METADATA_FIELD_ALT_SEED is missing (ALT seed read/write will be disabled)',
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
    hiddenTags,
    metadataFields: {
      altSeed: metadataFieldAltSeed,
    },
  };
}

function basicAuthHeader(privateKey) {
  const token = Buffer.from(`${privateKey}:`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

/**
 * The one answer for an ImageKit request that did not succeed (B415). Whatever
 * ImageKit said instead - a 4xx body, a 5xx, no answer at all - is logged here
 * and never reaches the client: its body is ImageKit's JSON, and its status
 * would let a 401 on our own key read as "you are signed out" to the editor.
 * So every refusal is `502 bad_gateway` with this sentence.
 */
const IMAGEKIT_REFUSAL = 'ImageKit could not complete this request';

/**
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<unknown>} - The parsed body of a successful answer.
 * @throws {AppError} - `502 bad_gateway` for any failure, see {@link IMAGEKIT_REFUSAL}.
 */
async function fetchJsonOrThrow(url, opts = {}) {
  const method = opts.method || 'GET';
  const where = `${method} ${new URL(url).pathname}`;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    logError('imagekit', `${where} did not reach ImageKit:`, err);
    throw new AppError(IMAGEKIT_REFUSAL, 502);
  }
  const ct = String(res.headers.get('content-type') || '');
  const isJson = ct.includes('application/json');
  const body = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => '');
  if (!res.ok) {
    logError('imagekit', `${where} answered ${res.status}:`, body);
    throw new AppError(IMAGEKIT_REFUSAL, 502);
  }
  return body;
}

/**
 * Escape a value for a double-quoted string in an ImageKit search query.
 * Backslash first, then quote — escaping the quote first would leave a
 * literal `\` in the value able to escape our own escape
 * (js/incomplete-sanitization).
 * @param {string} value
 * @returns {string}
 */
function escapeQueryValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toImageKitSearchQuery({ q, searchQuery }) {
  const sq = cleanStr(searchQuery);
  if (sq) return sq;
  const term = cleanStr(q);
  if (!term) return '';
  // ImageKit searchable fields: name, tags, path, format, size, width, height,
  // createdAt, updatedAt, customMetadata.*, embeddedMetadata.*
  // Note: description is NOT searchable via the API.
  const escaped = escapeQueryValue(term);
  // name HAS and tags HAS both support partial, case-insensitive matching
  // For multi-select custom metadata (like People), IN requires exact match with case variations
  const lower = escaped.toLowerCase();
  const title =
    escaped.charAt(0).toUpperCase() + escaped.slice(1).toLowerCase();
  const variants = [...new Set([escaped, lower, title])];
  const peopleClause = `"customMetadata.People" IN [${variants.map((v) => `"${v}"`).join(',')}]`;
  return `(name HAS "${escaped}" OR tags HAS "${escaped}" OR ${peopleClause})`;
}

/**
 * Narrow a listing query so files carrying an `IMAGEKIT_HIDDEN_TAGS` tag stay
 * out of pickers and search results. Lookups by id never pass through here:
 * a deck that already points at such a file must keep resolving it.
 * @param {string} sq - The listing's own query, empty for none.
 * @param {string[]} hiddenTags - From {@link getImageKitConfigFromEnv}.
 * @returns {string} - `sq` unchanged when nothing is hidden.
 */
function withHiddenTagsExcluded(sq, hiddenTags) {
  if (!hiddenTags.length) return sq;
  const list = hiddenTags.map((t) => `"${escapeQueryValue(t)}"`).join(', ');
  const clause = `tags NOT IN [${list}]`;
  // Parenthesise the caller's query: a bare `a OR b` would otherwise bind
  // looser than our AND and let hidden files back in through `a`.
  return sq ? `(${sq}) AND ${clause}` : clause;
}

/**
 * The `sort` values ImageKit accepts on `GET /v1/files`. Listing without one
 * gives oldest-first, which buries every recent upload past the first page —
 * so the default here is newest-first and callers may only narrow it to
 * another value from this set.
 * @type {ReadonlySet<string>}
 */
export const IMAGEKIT_SORT_VALUES = Object.freeze(
  new Set([
    'ASC_NAME',
    'DESC_NAME',
    'ASC_CREATED',
    'DESC_CREATED',
    'ASC_UPDATED',
    'DESC_UPDATED',
    'ASC_HEIGHT',
    'DESC_HEIGHT',
    'ASC_WIDTH',
    'DESC_WIDTH',
    'ASC_SIZE',
    'DESC_SIZE',
    'ASC_RELEVANCE',
    'DESC_RELEVANCE',
  ]),
);

export const IMAGEKIT_DEFAULT_SORT = 'DESC_CREATED';

/**
 * @param {unknown} sort - Caller-supplied sort, empty for the default.
 * @returns {string} - A value from {@link IMAGEKIT_SORT_VALUES}.
 * @throws {ValidationError} - When a non-empty value is not in the set.
 */
function normalizeSort(sort) {
  const s = cleanStr(sort).toUpperCase();
  if (!s) return IMAGEKIT_DEFAULT_SORT;
  if (!IMAGEKIT_SORT_VALUES.has(s)) {
    // `details` is a registered payload per code (`error-details.js`); a
    // plain `bad_request` carries none, so the fact goes in the message.
    throw new ValidationError(`Unsupported sort: ${s}`);
  }
  return s;
}

export async function listImageKitFiles({
  q,
  searchQuery,
  limit = 48,
  skip = 0,
  sort = '',
} = {}) {
  const cfg = getImageKitConfigFromEnv();
  if (!cfg.configured) {
    throw new ValidationError('ImageKit is not configured');
  }

  const sq = withHiddenTagsExcluded(
    toImageKitSearchQuery({ q, searchQuery }),
    cfg.hiddenTags,
  );
  const u = new URL('https://api.imagekit.io/v1/files');
  if (sq) u.searchParams.set('searchQuery', sq);
  u.searchParams.set(
    'limit',
    String(Math.max(1, Math.min(100, Number(limit) || 48))),
  );
  u.searchParams.set('skip', String(Math.max(0, Number(skip) || 0)));
  u.searchParams.set('sort', normalizeSort(sort));
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
    throw new ValidationError('ImageKit is not configured');
  }

  // Fetch multiple batches to get a good sample of tags
  const batchSize = 100;
  const batches = 5; // 500 files total
  const tagCounts = new Map();
  const hiddenQuery = withHiddenTagsExcluded('', cfg.hiddenTags);
  // Tags are counted lower-cased, so the hidden set is compared that way too.
  const hidden = new Set(cfg.hiddenTags.map((t) => t.toLowerCase()));

  for (let i = 0; i < batches; i++) {
    try {
      const u = new URL('https://api.imagekit.io/v1/files');
      u.searchParams.set('limit', String(batchSize));
      u.searchParams.set('skip', String(i * batchSize));
      if (hiddenQuery) u.searchParams.set('searchQuery', hiddenQuery);
      // Sample the newest files: a tag that only exists on recent uploads is
      // exactly the one a user goes looking for.
      u.searchParams.set('sort', IMAGEKIT_DEFAULT_SORT);

      const files = await fetchJsonOrThrow(u.toString(), {
        method: 'GET',
        headers: {
          Authorization: basicAuthHeader(cfg.privateKey),
        },
      });

      if (!Array.isArray(files) || files.length === 0) break;

      for (const file of files) {
        const tags = (Array.isArray(file?.tags) ? file.tags : [])
          .map((tag) =>
            typeof tag === 'string' ? tag.trim().toLowerCase() : '',
          )
          .filter(Boolean);
        // The query already leaves these out; this also covers a tag that
        // differs from the configured one only in case.
        if (tags.some((t) => hidden.has(t))) continue;
        for (const t of tags) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }

      // Stop if we got fewer files than requested (end of list)
      if (files.length < batchSize) break;
    } catch (err) {
      // A later batch failing leaves a smaller sample, which is still a
      // sample. The first failing leaves nothing: that is ImageKit refusing,
      // not an account without tags, so it answers the refusal (B415).
      if (i === 0) throw err;
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
    throw new ValidationError('ImageKit is not configured');
  }
  const id = cleanStr(fileId);
  if (!id) {
    throw new ValidationError('fileId is required');
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
    throw new ValidationError('ImageKit is not configured');
  }
  const id = cleanStr(fileId);
  if (!id) {
    throw new ValidationError('fileId is required');
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
    throw new ValidationError('ImageKit is not configured');
  }

  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new ValidationError('buffer is required and must be a Buffer');
  }

  if (!cleanStr(fileName)) {
    throw new ValidationError('fileName is required');
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

  if (Array.isArray(tags))
    form.append('tags', tags.filter((t) => cleanStr(t)).join(','));
  if (customMetadata && typeof customMetadata === 'object')
    form.append('customMetadata', JSON.stringify(customMetadata));

  return await fetchJsonOrThrow(
    'https://upload.imagekit.io/api/v1/files/upload',
    {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(cfg.privateKey),
      },
      body: form,
    },
  );
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
    log.info('Not configured, returning original URL');
    return imageUrl;
  }

  if (!imageUrl) {
    throw new Error('imageUrl is required');
  }

  try {
    // SSRF-guarded fetch: image URLs come from Notion blocks (an `external`
    // image URL is attacker-controllable). safeFetchRemoteImage refuses
    // non-public addresses, refuses redirects (which could hop into private
    // space after the check), times out, and caps the body size. A null
    // return throws here, falling back to the original URL.
    const fetched = await safeFetchRemoteImage(imageUrl, {
      maxBytes: 20 * 1024 * 1024,
    });
    if (!fetched) {
      throw new Error('Blocked or failed to fetch image');
    }
    const contentType =
      fetched.contentType === 'application/octet-stream'
        ? 'image/jpeg'
        : fetched.contentType;

    // Upload to ImageKit
    const result = await uploadImageKitBuffer({
      buffer: fetched.buffer,
      fileName: cleanStr(fileName) || 'image.jpg',
      mimeType: contentType,
      folder: options.folder || '',
      tags: options.tags || null,
    });

    return result?.url || imageUrl;
  } catch (e) {
    log.error(`Failed to upload from URL: ${e.message}`);
    // Return original URL as fallback
    return imageUrl;
  }
}
