import { getFeatureFlags } from '../../config/flags-snapshot.js';
import { badRequest, jsonError, methodNotAllowed, serveJson, serverError, unauthorized, requireJsonBody, withErrorHandler } from '../../utils/http.js';
import {
  getImageKitConfigFromEnv,
  listImageKitFiles,
  listImageKitTags,
  getImageKitFileDetails,
  patchImageKitFileDetails,
} from '../../media/imagekit.js';
import { getMediaStatus, getMediaProvider, isMediaProviderInitialized } from '../../media/index.js';
import { dispatchRoutes } from '../../utils/router.js';
import { getString } from '../../utils/request-validators.js';

// GET /api/media/status - Media provider status (public)
function handleMediaStatus({ res }) {
  serveJson(res, 200, getMediaStatus());
  return true;
}

// POST /api/media/presign - Create presigned upload URL (authenticated)
async function handleMediaPresign({ req, res, authedUser }) {
  if (!authedUser) return unauthorized(res);
  const flags = getFeatureFlags();
  if (flags.demoMode || flags.sandboxMode) {
    return badRequest(res, 'Uploads disabled in demo/sandbox mode');
  }

  if (!isMediaProviderInitialized()) {
    return badRequest(res, 'Media provider not initialized');
  }

  const provider = getMediaProvider();
  if (!provider.getStatus().supportsPresigned) {
    return badRequest(res, 'Current media provider does not support presigned uploads');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const { size } = body || {};
  const filename = getString(body, 'filename');
  const contentType = getString(body, 'contentType');

  if (!filename) {
    return badRequest(res, 'filename is required');
  }
  if (!contentType) {
    return badRequest(res, 'contentType is required');
  }

  try {
    const result = await provider.createPresignedUpload({ filename, contentType, size });
    serveJson(res, 200, result);
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) serverError(res, 'Presigned upload failed');
    else jsonError(res, status, 'presign_failed', err.message);
  }
  return true;
}

// POST /api/media/confirm - Confirm presigned upload completed (authenticated)
async function handleMediaConfirm({ req, res, authedUser }) {
  if (!authedUser) return unauthorized(res);

  if (!isMediaProviderInitialized()) {
    return badRequest(res, 'Media provider not initialized');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const key = getString(body, 'key');

  if (!key) {
    return badRequest(res, 'key is required');
  }

  const provider = getMediaProvider();
  const result = await provider.confirmUpload(key);
  serveJson(res, 200, result);
  return true;
}

// GET /api/media/imagekit/status - ImageKit status (no secrets)
function handleImageKitStatus({ res }) {
  const cfg = getImageKitConfigFromEnv();
  serveJson(res, 200, {
    configured: cfg.configured,
    issues: cfg.issues,
    warnings: cfg.warnings,
    uploadFolder: cfg.uploadFolder,
    tagPrefix: cfg.tagPrefix,
    metadataFields: cfg.metadataFields,
    recommendedNamedTransformations: [
      { id: 'deck_slide_full_2x', label: 'Slide (full) — 2x' },
      { id: 'deck_thumb_2x', label: 'Thumbnail — 2x' },
    ],
  });
  return true;
}

// GET /api/media/imagekit/files - List/search files
async function handleImageKitFiles({ res, url }) {
  const q = url.searchParams.get('q') || '';
  const searchQuery = url.searchParams.get('searchQuery') || '';
  const limit = url.searchParams.get('limit') || '';
  const skip = url.searchParams.get('skip') || '';
  const out = await listImageKitFiles({
    q,
    searchQuery,
    limit: Number(limit || 48),
    skip: Number(skip || 0),
  });
  serveJson(res, 200, out);
  return true;
}

// GET /api/media/imagekit/tags - List all tags (aggregated from files)
async function handleImageKitTagList({ res }) {
  const out = await listImageKitTags();
  serveJson(res, 200, out);
  return true;
}

// GET /api/media/imagekit/files/:id/details - Fetch file details (includes
// customMetadata)
async function handleImageKitDetailsGet({ res }, fileId) {
  const out = await getImageKitFileDetails(fileId);
  serveJson(res, 200, out);
  return true;
}

// PATCH /api/media/imagekit/files/:id/details - Update file details
async function handleImageKitDetailsPatch({ req, res, authedUser }, fileId) {
  if (!authedUser) return unauthorized(res);
  const flags = getFeatureFlags();
  if (flags.demoMode || flags.sandboxMode) return methodNotAllowed(res, ['GET']);
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const out = await patchImageKitFileDetails(fileId, body || {});
  serveJson(res, 200, out);
  return true;
}

/**
 * Declarative route table for `/api/media/*` (A7.19 C8). Order matches the
 * previous if-chain; every path sent an explicit 405, preserved as trailing
 * catch-all rows (Form B). Auth and demo/sandbox guards stay in the handlers,
 * after the method decision, where the original ran them.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/media/status', handler: handleMediaStatus },
  { pattern: '/api/media/status', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'POST', pattern: '/api/media/presign', handler: handleMediaPresign },
  { pattern: '/api/media/presign', handler: ({ res }) => methodNotAllowed(res, ['POST']) },
  { method: 'POST', pattern: '/api/media/confirm', handler: handleMediaConfirm },
  { pattern: '/api/media/confirm', handler: ({ res }) => methodNotAllowed(res, ['POST']) },
  { method: 'GET', pattern: '/api/media/imagekit/status', handler: handleImageKitStatus },
  { pattern: '/api/media/imagekit/status', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'GET', pattern: '/api/media/imagekit/files', handler: handleImageKitFiles },
  { pattern: '/api/media/imagekit/files', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'GET', pattern: '/api/media/imagekit/tags', handler: handleImageKitTagList },
  { pattern: '/api/media/imagekit/tags', handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'GET', pattern: /^\/api\/media\/imagekit\/files\/([^/]+)\/details$/, handler: handleImageKitDetailsGet },
  { method: 'PATCH', pattern: /^\/api\/media\/imagekit\/files\/([^/]+)\/details$/, handler: handleImageKitDetailsPatch },
  { pattern: /^\/api\/media\/imagekit\/files\/([^/]+)\/details$/, handler: ({ res }) => methodNotAllowed(res, ['GET', 'PATCH']) },
];

/**
 * Handle media API routes. The path-prefix guard runs before dispatch, as the
 * original chain's did.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleMedia = withErrorHandler('media', (ctx) => {
  if (!ctx.url.pathname.startsWith('/api/media/')) return false;
  return dispatchRoutes(ROUTES, ctx);
});
