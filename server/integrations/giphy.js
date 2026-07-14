/**
 * Giphy API client for animated GIF integration.
 *
 * Provides search and trending functionality for Giphy GIFs.
 * API compliance: shows "Powered by GIPHY" badge (handled in client UI).
 *
 * @see https://developers.giphy.com/docs/api
 */

import { apiFetch, createConfigChecker } from '../utils/api-fetch.js';

const GIPHY_API_BASE = 'https://api.giphy.com/v1/gifs';

/**
 * Check if Giphy API is configured.
 * @returns {boolean}
 */
export const isGiphyConfigured = createConfigChecker('GIPHY_API_KEY');

/**
 * Search Giphy GIFs.
 * @param {Object} options
 * @param {string} options.query - Search query
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {number} [options.limit=20] - Results per page (max 50)
 * @param {string} [options.rating='g'] - Content rating (g, pg, pg-13, r)
 * @returns {Promise<{ results: Array, total: number, offset: number }>}
 */
export async function searchGiphy({ query, offset = 0, limit = 20, rating = 'g' }) {
  if (!isGiphyConfigured()) {
    throw new Error('Giphy API is not configured');
  }

  const params = new URLSearchParams({
    api_key: process.env.GIPHY_API_KEY,
    q: query,
    offset: String(offset),
    limit: String(Math.min(limit, 50)),
    rating,
    lang: 'en',
  });

  const resp = await apiFetch(`${GIPHY_API_BASE}/search?${params}`, 'Giphy');
  const data = await resp.json();

  return {
    results: data.data.map(formatGif),
    total: data.pagination.total_count,
    offset: data.pagination.offset,
  };
}

/**
 * Get trending GIFs.
 * @param {Object} options
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {number} [options.limit=20] - Results per page (max 50)
 * @param {string} [options.rating='g'] - Content rating
 * @returns {Promise<{ results: Array, total: number, offset: number }>}
 */
export async function getTrendingGiphy({ offset = 0, limit = 20, rating = 'g' } = {}) {
  if (!isGiphyConfigured()) {
    throw new Error('Giphy API is not configured');
  }

  const params = new URLSearchParams({
    api_key: process.env.GIPHY_API_KEY,
    offset: String(offset),
    limit: String(Math.min(limit, 50)),
    rating,
  });

  const resp = await apiFetch(`${GIPHY_API_BASE}/trending?${params}`, 'Giphy');
  const data = await resp.json();

  return {
    results: data.data.map(formatGif),
    total: data.pagination.total_count,
    offset: data.pagination.offset,
  };
}

/**
 * Get a single GIF by ID.
 * @param {string} id - Giphy GIF ID
 * @returns {Promise<Object>}
 */
export async function getGiphyGif(id) {
  if (!isGiphyConfigured()) {
    throw new Error('Giphy API is not configured');
  }

  const params = new URLSearchParams({
    api_key: process.env.GIPHY_API_KEY,
  });

  const resp = await apiFetch(`${GIPHY_API_BASE}/${id}?${params}`, 'Giphy');
  const data = await resp.json();
  return formatGif(data.data);
}

/**
 * Download the actual GIF data from Giphy.
 * @param {string} url - The GIF URL to download
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function downloadGif(url) {
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`Failed to download GIF: ${resp.status}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get('content-type') || 'image/gif';

  return { buffer, contentType };
}

/**
 * Format a raw Giphy GIF object to our internal format.
 * @param {Object} gif - Raw Giphy GIF
 * @returns {Object}
 */
function formatGif(gif) {
  const original = gif.images.original;
  const preview = gif.images.fixed_width || gif.images.preview_gif;
  const still = gif.images.original_still || gif.images.fixed_width_still;

  return {
    id: gif.id,
    title: gif.title || '',
    slug: gif.slug,
    rating: gif.rating,
    urls: {
      original: original.url,
      preview: preview?.url || original.url,
      still: still?.url || '',
      mp4: original.mp4 || gif.images.original?.mp4 || '',
    },
    width: parseInt(original.width, 10),
    height: parseInt(original.height, 10),
    size: parseInt(original.size, 10) || 0,
    giphyUrl: gif.url,
    source: gif.source || '',
  };
}
