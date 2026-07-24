/**
 * Stock Media API routes for Unsplash and Giphy integration.
 *
 * Provides search, download, and status endpoints for stock media.
 * Downloaded media is saved to the image library for local hosting.
 */

import {
  json,
  methodNotAllowed,
  serveJson,
  badRequest,
  serverError,
} from '../../utils/http.js';
import { readAppSettings } from '../../storage/settings.js';
import { createImageLibraryItem } from '../../storage/image-library.js';
import { saveUploadedFile } from '../../storage/uploads.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('stock-media');
import {
  isUnsplashConfigured,
  searchUnsplash,
  getUnsplashPhoto,
  triggerDownload,
  downloadImage,
} from '../../integrations/unsplash.js';
import {
  isGiphyConfigured,
  searchGiphy,
  getTrendingGiphy,
  getGiphyGif,
  downloadGif,
} from '../../integrations/giphy.js';

/**
 * Get stock media provider status and configuration.
 * @param {string} repoRoot - Repository root path
 * @returns {Promise<Object>}
 */
async function getStockMediaStatus(repoRoot) {
  const settings = await readAppSettings(repoRoot);
  const stockMedia = settings?.stockMedia || {};

  return {
    unsplash: {
      configured: isUnsplashConfigured(),
      enabled: stockMedia.unsplash?.enabled === true,
    },
    giphy: {
      configured: isGiphyConfigured(),
      enabled: stockMedia.giphy?.enabled === true,
    },
  };
}

/**
 * Handle stock media API routes.
 * @param {Object} ctx - Request context
 * @returns {Promise<boolean>} - True if handled
 */
export async function handleStockMedia({ repoRoot, req, res, url, authedUser }) {
  // Status endpoint (public for UI to know what's available)
  if (url.pathname === '/api/stock-media/status') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const status = await getStockMediaStatus(repoRoot);
    serveJson(res, 200, status);
    return true;
  }

  // All other endpoints require authentication
  if (!authedUser) return false;

  // === UNSPLASH ENDPOINTS ===

  // Search Unsplash photos
  if (url.pathname === '/api/stock-media/unsplash/search') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    const status = await getStockMediaStatus(repoRoot);
    if (!status.unsplash.configured || !status.unsplash.enabled) {
      return badRequest(res, 'Unsplash is not available');
    }

    const query = url.searchParams.get('q') || '';
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = parseInt(url.searchParams.get('per_page') || '20', 10);

    if (!query.trim()) {
      return badRequest(res, 'Search query required');
    }

    try {
      const results = await searchUnsplash({ query, page, perPage });
      serveJson(res, 200, results);
    } catch (e) {
      log.error('Unsplash search error:', e);
      serverError(res, 'Unsplash search failed');
    }
    return true;
  }

  // Download Unsplash photo and add to library
  if (url.pathname === '/api/stock-media/unsplash/download') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const status = await getStockMediaStatus(repoRoot);
    if (!status.unsplash.configured || !status.unsplash.enabled) {
      return badRequest(res, 'Unsplash is not available');
    }

    const body = await json(req);
    const { photoId, size = 'regular' } = body || {};

    if (!photoId) {
      return badRequest(res, 'Photo ID required');
    }

    try {
      // Get photo details
      const photo = await getUnsplashPhoto(photoId);

      // Trigger download tracking (required by Unsplash API terms)
      await triggerDownload(photo.downloadLocation);

      // Download the image
      const imageUrl = photo.urls[size] || photo.urls.regular;
      const { buffer, contentType } = await downloadImage(imageUrl);

      // Determine file extension
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const filename = `unsplash-${photoId}-${size}.${ext}`;

      // Save to uploads
      const localUrl = await saveUploadedFile(repoRoot, buffer, filename, contentType);

      // Add to image library with attribution
      const libraryItem = await createImageLibraryItem(repoRoot, {
        url: localUrl,
        description: photo.description || '',
        photographer: photo.photographer.name,
        source: 'unsplash',
        sourceUrl: photo.unsplashUrl,
        tags: ['unsplash'],
      });

      serveJson(res, 200, {
        ok: true,
        libraryItem,
        attribution: {
          photographer: photo.photographer.name,
          photographerUrl: photo.photographer.profileUrl,
          unsplashUrl: photo.unsplashUrl,
        },
      });
    } catch (e) {
      log.error('Unsplash download error:', e);
      serverError(res, 'Unsplash download failed');
    }
    return true;
  }

  // === GIPHY ENDPOINTS ===

  // Search Giphy GIFs
  if (url.pathname === '/api/stock-media/giphy/search') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    const status = await getStockMediaStatus(repoRoot);
    if (!status.giphy.configured || !status.giphy.enabled) {
      return badRequest(res, 'Giphy is not available');
    }

    const query = url.searchParams.get('q') || '';
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (!query.trim()) {
      return badRequest(res, 'Search query required');
    }

    try {
      const results = await searchGiphy({ query, offset, limit });
      serveJson(res, 200, results);
    } catch (e) {
      log.error('Giphy search error:', e);
      serverError(res, 'Giphy search failed');
    }
    return true;
  }

  // Trending Giphy GIFs
  if (url.pathname === '/api/stock-media/giphy/trending') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    const status = await getStockMediaStatus(repoRoot);
    if (!status.giphy.configured || !status.giphy.enabled) {
      return badRequest(res, 'Giphy is not available');
    }

    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    try {
      const results = await getTrendingGiphy({ offset, limit });
      serveJson(res, 200, results);
    } catch (e) {
      log.error('Giphy trending error:', e);
      serverError(res, 'Giphy trending failed');
    }
    return true;
  }

  // Download Giphy GIF and add to library
  if (url.pathname === '/api/stock-media/giphy/download') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const status = await getStockMediaStatus(repoRoot);
    if (!status.giphy.configured || !status.giphy.enabled) {
      return badRequest(res, 'Giphy is not available');
    }

    const body = await json(req);
    const { gifId } = body || {};

    if (!gifId) {
      return badRequest(res, 'GIF ID required');
    }

    try {
      // Get GIF details
      const gif = await getGiphyGif(gifId);

      // Download the GIF
      const { buffer, contentType } = await downloadGif(gif.urls.original);

      // Save to uploads
      const filename = `giphy-${gifId}.gif`;
      const localUrl = await saveUploadedFile(repoRoot, buffer, filename, contentType);

      // Add to image library
      const libraryItem = await createImageLibraryItem(repoRoot, {
        url: localUrl,
        description: gif.title || '',
        source: 'giphy',
        sourceUrl: gif.giphyUrl,
        tags: ['giphy', 'gif', 'animated'],
      });

      serveJson(res, 200, {
        ok: true,
        libraryItem,
      });
    } catch (e) {
      log.error('Giphy download error:', e);
      serverError(res, 'Giphy download failed');
    }
    return true;
  }

  return false;
}
