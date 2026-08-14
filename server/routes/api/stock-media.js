/**
 * Stock media API routes — the image sources beside the native library.
 *
 * Three providers share one status endpoint and one `stockMedia.<id>.enabled`
 * toggle: `bundled` (gradients that ship with the app), `unsplash` and `giphy`.
 * The two remote ones search a third-party API and copy the bytes into the
 * image library; `bundled` has nothing to fetch and nothing to copy — its
 * manifest lists static assets under `/assets/gradients/`, so it is `configured`
 * unconditionally. See server/media/bundled-gradients.js.
 */

import {
  methodNotAllowed,
  serveJson,
  badRequest,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import { getAppSettings } from '../../storage/settings.js';
import { createImageLibraryItem } from '../../storage/image-library/index.js';
import { writeUploadedFile } from '../../storage/uploads.js';
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
import { listBundledGradients } from '../../media/bundled-gradients.js';
import { dispatchRoutes } from '../../utils/router.js';
import { crossOrganizationScope } from '../../storage/scope.js';

/**
 * Get stock media provider status and configuration.
 * @param {string} repoRoot - Repository root path
 * @returns {Promise<Object>}
 */
async function getStockMediaStatus(repoRoot) {
  const settings = await getAppSettings(
    crossOrganizationScope(repoRoot, 'stock media source toggles: instance-level settings')
  );
  const stockMedia = settings?.stockMedia || {};

  return {
    // No key to miss and no service to reach: always configured.
    bundled: {
      configured: true,
      enabled: stockMedia.bundled?.enabled === true,
    },
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

// GET /api/stock-media/status - Provider status (public for UI to know
// what's available)
async function handleStockMediaProviderStatus({ repoRoot, res }) {
  const status = await getStockMediaStatus(repoRoot);
  serveJson(res, 200, status);
  return true;
}

// GET /api/stock-media/bundled/manifest - List the gradients that ship with
// the app. No search, no pagination and no download step: the whole library is
// a few dozen static assets, and a pick is just its URL — the picker writes it
// straight onto the slide.
async function handleBundledManifest({ repoRoot, res }) {
  const status = await getStockMediaStatus(repoRoot);
  if (!status.bundled.enabled) {
  return badRequest(res, 'Bundled gradients are not available');
}

  const items = await listBundledGradients(repoRoot);
  serveJson(res, 200, { items });
  return true;
}

// GET /api/stock-media/unsplash/search - Search Unsplash photos
async function handleUnsplashSearch({ repoRoot, res, url }) {
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

  const results = await searchUnsplash({ query, page, perPage });
  serveJson(res, 200, results);
  return true;
}

// POST /api/stock-media/unsplash/download - Download Unsplash photo and add
// to library
async function handleUnsplashDownload({ repoRoot, storageScope, req, res }) {
  const status = await getStockMediaStatus(repoRoot);
  if (!status.unsplash.configured || !status.unsplash.enabled) {
    return badRequest(res, 'Unsplash is not available');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const { photoId, size = 'regular' } = body || {};

  if (!photoId) {
    return badRequest(res, 'Photo ID required');
  }

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
  const localUrl = await writeUploadedFile(repoRoot, buffer, filename, contentType);

  // Add to image library with attribution
  const libraryItem = await createImageLibraryItem(storageScope, {
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
  return true;
}

// GET /api/stock-media/giphy/search - Search Giphy GIFs
async function handleGiphySearch({ repoRoot, res, url }) {
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

  const results = await searchGiphy({ query, offset, limit });
  serveJson(res, 200, results);
  return true;
}

// GET /api/stock-media/giphy/trending - Trending Giphy GIFs
async function handleGiphyTrending({ repoRoot, res, url }) {
  const status = await getStockMediaStatus(repoRoot);
  if (!status.giphy.configured || !status.giphy.enabled) {
    return badRequest(res, 'Giphy is not available');
  }

  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);

  const results = await getTrendingGiphy({ offset, limit });
  serveJson(res, 200, results);
  return true;
}

// POST /api/stock-media/giphy/download - Download Giphy GIF and add to library
async function handleGiphyDownload({ repoRoot, storageScope, req, res }) {
  const status = await getStockMediaStatus(repoRoot);
  if (!status.giphy.configured || !status.giphy.enabled) {
    return badRequest(res, 'Giphy is not available');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const { gifId } = body || {};

  if (!gifId) {
    return badRequest(res, 'GIF ID required');
  }

  // Get GIF details
  const gif = await getGiphyGif(gifId);

  // Download the GIF
  const { buffer, contentType } = await downloadGif(gif.urls.original);

  // Save to uploads
  const filename = `giphy-${gifId}.gif`;
  const localUrl = await writeUploadedFile(repoRoot, buffer, filename, contentType);

  // Add to image library
  const libraryItem = await createImageLibraryItem(storageScope, {
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
  return true;
}

/**
 * Public rows: the status endpoint is served before the module's auth guard,
 * exactly as the original chain did (the UI probes it before login). It sent
 * an explicit 405 for a wrong method, kept as a catch-all row (Form B).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const PUBLIC_ROUTES = [
  { method: 'GET', pattern: '/api/stock-media/status', handler: handleStockMediaProviderStatus },
  { pattern: '/api/stock-media/status', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
];

/**
 * Authenticated rows (A7.19 C8). Order matches the previous if-chain; every
 * path checked the method first and sent an explicit 405, kept as trailing
 * catch-all rows (Form B). The provider feature checks stay in the handlers,
 * after the method decision, where the original ran them.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const AUTHED_ROUTES = [
  { method: 'GET', pattern: '/api/stock-media/bundled/manifest', handler: handleBundledManifest },
  { pattern: '/api/stock-media/bundled/manifest', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'GET', pattern: '/api/stock-media/unsplash/search', handler: handleUnsplashSearch },
  { pattern: '/api/stock-media/unsplash/search', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'POST', pattern: '/api/stock-media/unsplash/download', handler: handleUnsplashDownload },
  { pattern: '/api/stock-media/unsplash/download', handler: ({ res }) => methodNotAllowed(res, ['POST']) },
  { method: 'GET', pattern: '/api/stock-media/giphy/search', handler: handleGiphySearch },
  { pattern: '/api/stock-media/giphy/search', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'GET', pattern: '/api/stock-media/giphy/trending', handler: handleGiphyTrending },
  { pattern: '/api/stock-media/giphy/trending', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'POST', pattern: '/api/stock-media/giphy/download', handler: handleGiphyDownload },
  { pattern: '/api/stock-media/giphy/download', handler: ({ res }) => methodNotAllowed(res, ['POST']) },
];

/**
 * Handle stock media API routes. Two dispatch phases mirror the original
 * chain: the public status row runs first, then the module-wide auth guard
 * (fall-through, not a 401), then the authenticated rows.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} - True if handled
 */
export const handleStockMedia = withErrorHandler('stock-media', async (ctx) => {
  const publicResult = await dispatchRoutes(PUBLIC_ROUTES, ctx);
  if (publicResult !== false) return publicResult;

  // All other endpoints require authentication
  if (!ctx.authedUser) return false;

  return dispatchRoutes(AUTHED_ROUTES, ctx);
});
