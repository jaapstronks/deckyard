import { badRequest, jsonError, serveJson, serverError, unauthorized, requireJsonBody } from '../../utils/http.js';
import { getMediaProvider, isMediaProviderInitialized } from '../../media/index.js';
import { getFeatureFlags } from '../../config/feature-flags.js';
import { getDataUrl } from '../../utils/request-validators.js';

export async function handleUploads({ repoRoot, req, res, url, authedUser }) {
  // Uploads (server-side, for local provider or fallback)
  if (url.pathname === '/api/uploads' && req.method === 'POST') {
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
  return false;
}
