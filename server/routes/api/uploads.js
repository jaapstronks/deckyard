import { badRequest, json, serveJson, unauthorized } from '../../utils/http.js';
import { getMediaProvider, isMediaProviderInitialized } from '../../media/index.js';
import { getFeatureFlags } from '../../config/feature-flags.js';

export async function handleUploads({ repoRoot, req, res, url, authedUser }) {
  // Uploads (server-side, for local provider or fallback)
  if (url.pathname === '/api/uploads' && req.method === 'POST') {
    if (!authedUser) return unauthorized(res);

    const flags = getFeatureFlags();
    if (flags.demoMode || flags.sandboxMode) {
      return badRequest(res, 'Uploads disabled in demo/sandbox mode');
    }

    const body = await json(req);
    const { dataUrl, originalName } = body || {};
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
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
      serveJson(res, status, { error: err.message });
    }
    return true;
  }
  return false;
}
