import {
  createImageLibraryItem,
  deleteImageLibraryItem,
  getImageLibraryItem,
  listImageLibrary,
  updateImageLibraryItem,
  getImageFavorites,
  toggleImageFavorite,
} from '../../storage/image-library.js';
import { getImageLibraryUsage } from '../../storage/image-library-usage.js';
import { replaceUploadFromDataUrl } from '../../storage/uploads.js';
import {
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../utils/http.js';
import { getFeatureFlags } from '../../config/feature-flags.js';
import { generateImageAltTexts } from '../../utils/llm/alt-text.js';
import { listSandboxMedia } from '../../sandbox/media.js';

export async function handleImageLibrary({ repoRoot, req, res, url, authedUser }) {
  const flags = getFeatureFlags();

  // Shared image library (shared across users)
  if (url.pathname === '/api/image-library') {
    if (flags.disableImageLibrary) return notFound(res);
    if (req.method === 'GET') {
      const items = await listImageLibrary(repoRoot);
      // Sandbox: uploads are off, so seed a curated set of sample images and
      // logos a guest can actually place on a slide.
      if (flags.sandboxMode) items.unshift(...listSandboxMedia());
      // Get user's favorites if logged in
      let favoriteIds = [];
      if (authedUser?.email) {
        favoriteIds = await getImageFavorites(authedUser.email);
      }
      const favoriteSet = new Set(favoriteIds);
      // Add isFavorite flag to each item
      const itemsWithFavorites = items.map((item) => ({
        ...item,
        isFavorite: favoriteSet.has(item.id),
      }));
      serveJson(res, 200, { items: itemsWithFavorites, favoriteIds });
      return true;
    }
    if (req.method === 'POST') {
      // Demo stance: keep the library read-only (curated) to avoid abuse.
      if (flags.demoMode || flags.sandboxMode) return methodNotAllowed(res, ['GET']);
      if (!authedUser) return unauthorized(res, 'Login required');
      const body = await json(req);
      // Capture who uploaded this image
      const created = await createImageLibraryItem(repoRoot, {
        ...body,
        uploadedBy: authedUser.email || null,
      });
      serveJson(res, 201, created);
      return true;
    }
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  // Generate alt texts (preview; does not persist)
  if (url.pathname === '/api/image-library/generate-alts') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (flags.demoMode || flags.sandboxMode) return methodNotAllowed(res, ['GET']);
    if (!authedUser) return unauthorized(res, 'Login required');
    if (!flags.aiAltText) return unauthorized(res, 'AI alt text is not enabled');
    const body = await json(req);
    const out = await generateImageAltTexts({
      repoRoot,
      imageUrl: body?.url,
      description: body?.description || '',
      tags: body?.tags || [],
      photographer: body?.photographer || '',
      context: body?.context || null,
      vendor: 'openai',
    });
    serveJson(res, 200, { alts: { nl: out.nl, 'en-GB': out['en-GB'] } });
    return true;
  }

  const usageMatch = url.pathname.match(
    /^\/api\/image-library\/([^/]+)\/usage$/
  );
  if (usageMatch) {
    if (flags.disableImageLibrary) return notFound(res);
    const imageId = usageMatch[1];
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const item = await getImageLibraryItem(repoRoot, imageId);
    if (!item) return notFound(res);
    const usage = await getImageLibraryUsage(repoRoot, item.url);
    serveJson(res, 200, {
      id: item.id,
      url: item.url,
      usage,
    });
    return true;
  }

  const genMatch = url.pathname.match(
    /^\/api\/image-library\/([^/]+)\/generate-alts$/
  );
  if (genMatch) {
    if (flags.disableImageLibrary) return notFound(res);
    const imageId = genMatch[1];
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (flags.demoMode || flags.sandboxMode) return methodNotAllowed(res, ['GET']);
    if (!authedUser) return unauthorized(res, 'Login required');
    if (!flags.aiAltText) return unauthorized(res, 'AI alt text is not enabled');
    const item = await getImageLibraryItem(repoRoot, imageId);
    if (!item) return notFound(res);
    const body = await json(req);
    const out = await generateImageAltTexts({
      repoRoot,
      imageUrl: item.url,
      description: item.description || '',
      tags: item.tags || [],
      photographer: item.photographer || '',
      context: body?.context || null,
      vendor: 'openai',
    });
    serveJson(res, 200, { alts: { nl: out.nl, 'en-GB': out['en-GB'] } });
    return true;
  }

  const replaceMatch = url.pathname.match(
    /^\/api\/image-library\/([^/]+)\/replace-upload$/
  );
  if (replaceMatch) {
    if (flags.disableImageLibrary) return notFound(res);
    const imageId = replaceMatch[1];
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (flags.demoMode || flags.sandboxMode) return methodNotAllowed(res, ['GET']);
    if (!authedUser) return unauthorized(res, 'Login required');

    const item = await getImageLibraryItem(repoRoot, imageId);
    if (!item) return notFound(res);
    if (!String(item.url || '').startsWith('/uploads/')) {
      return serveJson(res, 400, {
        error:
          'This image is not stored as a local upload (/uploads/...), so it cannot be replaced in-place.',
      });
    }

    const body = await json(req);
    const { dataUrl } = body || {};
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return serveJson(res, 400, {
        error: 'Expected { dataUrl: "data:<mime>;base64,..." }',
      });
    }

    await replaceUploadFromDataUrl(repoRoot, item.url, dataUrl);
    const updated = await updateImageLibraryItem(repoRoot, imageId, {});
    serveJson(res, 200, updated);
    return true;
  }

  // Toggle favorite status
  const favoriteMatch = url.pathname.match(
    /^\/api\/image-library\/([^/]+)\/favorite$/
  );
  if (favoriteMatch) {
    if (flags.disableImageLibrary) return notFound(res);
    const imageId = favoriteMatch[1];
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (!authedUser) return unauthorized(res, 'Login required');

    const item = await getImageLibraryItem(repoRoot, imageId);
    if (!item) return notFound(res);

    const isFavorite = await toggleImageFavorite(imageId, authedUser.email);
    serveJson(res, 200, { id: imageId, isFavorite });
    return true;
  }

  const imgLibMatch = url.pathname.match(/^\/api\/image-library\/([^/]+)$/);
  if (imgLibMatch) {
    if (flags.disableImageLibrary) return notFound(res);
    const imageId = imgLibMatch[1];
    if (req.method === 'GET') {
      const item = await getImageLibraryItem(repoRoot, imageId);
      if (!item) return notFound(res);
      serveJson(res, 200, item);
      return true;
    }
    if (req.method === 'PUT') {
      if (flags.demoMode || flags.sandboxMode) return methodNotAllowed(res, ['GET']);
      if (!authedUser) return unauthorized(res, 'Login required');
      const body = await json(req);
      const updated = await updateImageLibraryItem(repoRoot, imageId, body);
      if (!updated) return notFound(res);
      serveJson(res, 200, updated);
      return true;
    }
    if (req.method === 'DELETE') {
      if (flags.demoMode || flags.sandboxMode) return methodNotAllowed(res, ['GET']);
      if (!authedUser?.isAdmin) return unauthorized(res, 'Admin required');
      const ok = await deleteImageLibraryItem(repoRoot, imageId);
      if (!ok) return notFound(res);
      serveJson(res, 200, { ok: true });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
  }

  return false;
}
