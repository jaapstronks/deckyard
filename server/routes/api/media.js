import { getFeatureFlags } from '../../config/feature-flags.js';
import { badRequest, json, methodNotAllowed, serveJson, unauthorized } from '../../utils/http.js';
import {
  getImageKitConfigFromEnv,
  listImageKitFiles,
  listImageKitTags,
  getImageKitFileDetails,
  patchImageKitFileDetails,
} from '../../media/imagekit.js';
import { getMediaStatus, getMediaProvider, isMediaProviderInitialized } from '../../media/index.js';

export async function handleMedia({ repoRoot, req, res, url, authedUser }) {
  if (!url.pathname.startsWith('/api/media/')) return false;

  const flags = getFeatureFlags();

  // Media provider status (public)
  if (url.pathname === '/api/media/status') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    serveJson(res, 200, getMediaStatus());
    return true;
  }

  // Create presigned upload URL (authenticated)
  if (url.pathname === '/api/media/presign') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (!authedUser) return unauthorized(res);
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

    const body = await json(req);
    const { filename, contentType, size } = body || {};

    if (!filename || typeof filename !== 'string') {
      return badRequest(res, 'filename is required');
    }
    if (!contentType || typeof contentType !== 'string') {
      return badRequest(res, 'contentType is required');
    }

    try {
      const result = await provider.createPresignedUpload({ filename, contentType, size });
      serveJson(res, 200, result);
    } catch (err) {
      const status = err.statusCode || 500;
      serveJson(res, status, { error: err.message });
    }
    return true;
  }

  // Confirm presigned upload completed (authenticated)
  if (url.pathname === '/api/media/confirm') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (!authedUser) return unauthorized(res);

    if (!isMediaProviderInitialized()) {
      return badRequest(res, 'Media provider not initialized');
    }

    const body = await json(req);
    const { key } = body || {};

    if (!key || typeof key !== 'string') {
      return badRequest(res, 'key is required');
    }

    const provider = getMediaProvider();
    const result = await provider.confirmUpload(key);
    serveJson(res, 200, result);
    return true;
  }

  // Status (no secrets)
  if (url.pathname === '/api/media/imagekit/status') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
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

  // List/search files
  if (url.pathname === '/api/media/imagekit/files') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
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

  // List all tags (aggregated from files)
  if (url.pathname === '/api/media/imagekit/tags') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const out = await listImageKitTags();
    serveJson(res, 200, out);
    return true;
  }

  // GET/PATCH file details
  const detailsMatch = url.pathname.match(
    /^\/api\/media\/imagekit\/files\/([^/]+)\/details$/
  );
  if (detailsMatch) {
    const fileId = detailsMatch[1];

    // GET - fetch file details (includes customMetadata)
    if (req.method === 'GET') {
      const out = await getImageKitFileDetails(fileId);
      serveJson(res, 200, out);
      return true;
    }

    // PATCH - update file details
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['GET', 'PATCH']);
    if (!authedUser) return unauthorized(res);
    if (flags.demoMode || flags.sandboxMode) return methodNotAllowed(res, ['GET']);
    const body = await json(req);
    const out = await patchImageKitFileDetails(fileId, body || {});
    serveJson(res, 200, out);
    return true;
  }

  return false;
}
