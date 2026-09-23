/**
 * Unsplash API client for stock photo integration.
 *
 * Provides search and download functionality for Unsplash photos.
 * API compliance: triggers download endpoint for analytics, includes attribution.
 *
 * @see https://unsplash.com/documentation
 */

import {
  apiFetch,
  apiFetchJson,
  createConfigChecker,
  isJsonObject,
} from '../utils/api-fetch.js';
import { createLogger } from '../utils/logger.js';
import { envStr } from '../config/utils.js';

const log = createLogger('unsplash');

const UNSPLASH_API_BASE = 'https://api.unsplash.com';

/**
 * Check if Unsplash API is configured.
 * @returns {boolean}
 */
export const isUnsplashConfigured = createConfigChecker('UNSPLASH_ACCESS_KEY');

/**
 * Get authorization headers for Unsplash API.
 * @returns {Object}
 */
function getHeaders() {
  return {
    Authorization: `Client-ID ${envStr('UNSPLASH_ACCESS_KEY')}`,
    'Accept-Version': 'v1',
  };
}

/**
 * Search Unsplash photos.
 * @param {Object} options
 * @param {string} options.query - Search query
 * @param {number} [options.page=1] - Page number
 * @param {number} [options.perPage=20] - Results per page (max 30)
 * @returns {Promise<{ results: Array, total: number, totalPages: number }>}
 */
export async function searchUnsplash({ query, page = 1, perPage = 20 }) {
  const params = new URLSearchParams({
    query,
    page: String(page),
    per_page: String(Math.min(perPage, 30)),
  });

  const data = await apiFetchJson(
    `${UNSPLASH_API_BASE}/search/photos?${params}`,
    'Unsplash',
    isPhotoPage,
    { headers: getHeaders() },
  );

  return {
    results: data.results.map(formatPhoto),
    total: data.total,
    totalPages: data.total_pages,
  };
}

/**
 * Get a single photo by ID.
 * @param {string} id - Unsplash photo ID
 * @returns {Promise<Object>}
 */
export async function getUnsplashPhoto(id) {
  const photo = await apiFetchJson(
    `${UNSPLASH_API_BASE}/photos/${id}`,
    'Unsplash',
    isPhoto,
    { headers: getHeaders() },
  );
  return formatPhoto(photo);
}

/**
 * Trigger download tracking for a photo (required by Unsplash API terms).
 * This should be called when a user actually downloads/uses a photo.
 * @param {string} downloadLocation - The download_location URL from the photo
 * @returns {Promise<void>}
 */
export async function triggerDownload(downloadLocation) {
  // The download_location already includes the client_id parameter,
  // but we need to add our authorization header
  const resp = await fetch(downloadLocation, {
    headers: getHeaders(),
  });

  if (!resp.ok) {
    log.warn(`Unsplash download tracking failed: ${resp.status}`);
  }
}

/**
 * Download the actual image data from Unsplash.
 * @param {string} url - The image URL to download
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function downloadImage(url) {
  const resp = await apiFetch(url, 'Unsplash');
  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get('content-type') || 'image/jpeg';

  return { buffer, contentType };
}

/**
 * Whether a search body carries what {@link formatPhoto} and the paging read
 * (B421).
 * @param {any} body
 * @returns {boolean}
 */
function isPhotoPage(body) {
  return (
    isJsonObject(body) &&
    Array.isArray(body.results) &&
    body.results.every(isPhoto)
  );
}

/**
 * Whether a raw Unsplash photo carries what {@link formatPhoto} reads (B421).
 * @param {any} photo
 * @returns {boolean}
 */
function isPhoto(photo) {
  return (
    isJsonObject(photo) &&
    isJsonObject(photo.urls) &&
    isJsonObject(photo.user) &&
    isJsonObject(photo.user.links) &&
    isJsonObject(photo.links)
  );
}

/**
 * Format a raw Unsplash photo object to our internal format.
 * @param {Object} photo - Raw Unsplash photo
 * @returns {Object}
 */
function formatPhoto(photo) {
  return {
    id: photo.id,
    description: photo.description || photo.alt_description || '',
    width: photo.width,
    height: photo.height,
    color: photo.color,
    urls: {
      thumb: photo.urls.thumb,
      small: photo.urls.small,
      regular: photo.urls.regular,
      full: photo.urls.full,
      raw: photo.urls.raw,
    },
    photographer: {
      name: photo.user.name,
      username: photo.user.username,
      profileUrl: photo.user.links.html,
    },
    downloadLocation: photo.links.download_location,
    unsplashUrl: photo.links.html,
  };
}
