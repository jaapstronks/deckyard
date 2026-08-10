import { badRequest, jsonError, serveJson, serverError, unauthorized, requireJsonBody } from '../../utils/http.js';
import { getMediaProvider, isMediaProviderInitialized } from '../../media/index.js';
import { getFeatureFlags } from '../../config/feature-flags.js';
import { dispatchRoutes } from '../../utils/router.js';
import { getDataUrl } from '../../utils/request-validators.js';

// POST /api/uploads - Server-side upload (for local provider or fallback)
async function handleUploadCreate({ req, res, authedUser }) {
  if (!authedUser) return unauthorized(res);

  const flags = getFeatureFlags();
  if (flags.demoMode || flags.sandboxMode) {
    return badRequest(res, 'Uploads disabled in demo/sandbox mode');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const { originalName } = body || {};
  const dataUrl = getDataUrl(body, 'dataUrl');
  if (!dataUrl) {
    return badRequest(
      res,
      'Expected { dataUrl: "data:<mime>;base64,..." }'
    );
  }

  if (!isMediaProviderInitialized()) {
    return badRequest(res, 'Media provider not initialized');
  }

  try {
    const provider = getMediaProvider();
    const result = await provider.uploadDataUrl({
      dataUrl,
      filename: originalName || 'image',
    });

    serveJson(res, 201, {
      filename: result.key,
      url: result.publicUrl,
      mime: result.contentType,
      bytes: result.size,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) serverError(res, 'Upload failed');
    else jsonError(res, status, 'upload_failed', err.message);
  }
  return true;
}

/**
 * Declarative route table for `/api/uploads` (A7.19 C8): one POST-only row
 * that falls through on any other method (Form A), exactly as the original
 * single-branch chain did.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'POST', pattern: '/api/uploads', handler: handleUploadCreate },
];

/**
 * Handle upload API routes.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleUploads(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
