import {
  createImageLibraryItem,
  deleteImageLibraryItem,
  getImageLibraryItem,
  listImageLibrary,
  updateImageLibraryItem,
  isImageFavorite,
  stampFavorites,
  toggleImageFavorite,
} from '../../storage/image-library.js';
import { getImageLibraryUsage } from '../../storage/image-library-usage.js';
import { replaceUploadFromDataUrl } from '../../storage/uploads.js';
import {
  badRequest,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  requireJsonBody,
  withErrorHandler,
  forbidden,
} from '../../utils/http.js';
import { getFeatureFlags } from '../../config/flags-snapshot.js';
import { dispatchRoutes } from '../../utils/router.js';
import { generateImageAltTexts } from '../../utils/llm/alt-text.js';
import { listSandboxMedia } from '../../sandbox/media.js';
import { getDataUrl } from '../../utils/request-validators.js';
import { isOrganizationAdmin } from '../../../shared/organization-role.js';

/**
 * Stamp the caller's own star on an item the route hands back (D176: every
 * item a route returns carries `favorite` for the caller). Derived, never
 * stored on the item and never part of the edit contract — a PUT body that
 * carries it is ignored, because `updateImageLibraryItem` writes a closed key
 * set. An anonymous caller has no star, so the flag is false without a query.
 * @param {import('../../storage/scope.js').StorageScope} storageScope
 * @param {{email?: string}|null} authedUser
 * @param {object} item - A mapped image-library item
 * @returns {Promise<object>} The item with `favorite`
 */
async function withFavorite(storageScope, authedUser, item) {
  const email = authedUser?.email;
  const favorite = email
    ? await isImageFavorite(storageScope, item.id, email)
    : false;
  return { ...item, favorite };
}

// GET /api/image-library - Shared image library (shared across users).
async function handleListImageLibrary({ storageScope, res, authedUser }) {
  const items = await listImageLibrary(storageScope);
  // Sandbox: uploads are off, so seed a curated set of sample images and
  // logos a guest can actually place on a slide.
  if (getFeatureFlags().sandboxMode) items.unshift(...listSandboxMedia());
  // One star per item, spelled `favorite` (D176). The caller's own flag,
  // derived in the facade — the same stamper the bulk export uses, so the
  // two surfaces cannot disagree about whose star an item carries.
  serveJson(res, 200, {
    items: await stampFavorites(storageScope, items, authedUser?.email),
  });
  return true;
}

// POST /api/image-library - Add an item.
async function handleCreateImageLibraryItem({
  storageScope,
  req,
  res,
  authedUser,
}) {
  const flags = getFeatureFlags();
  // Demo stance: keep the library read-only (curated) to avoid abuse.
  if (flags.demoMode || flags.sandboxMode)
    return methodNotAllowed(res, ['GET']);
  if (!authedUser) return unauthorized(res, 'Login required');
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Capture who uploaded this image
  const created = await createImageLibraryItem(storageScope, {
    ...body,
    uploadedBy: authedUser.email || null,
  });
  // A fresh image is nobody's favorite yet, but it still answers in the one
  // shape every item-returning route uses (D176).
  serveJson(res, 201, { ...created, favorite: false });
  return true;
}

// POST /api/image-library/generate-alts - Generate alt texts (preview; does
// not persist). A `feature: 'ai'` row: with AI off (kill switch, demo, sandbox) the
// dispatcher answers 404 before this runs; `aiAltText` then only adds the
// OpenAI-vendor requirement.
async function handleGenerateAltsPreview({ repoRoot, req, res, authedUser }) {
  const flags = getFeatureFlags();
  if (!authedUser) return unauthorized(res, 'Login required');
  if (!flags.aiAltText) return forbidden(res, 'AI alt text is not enabled');
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const out = await generateImageAltTexts({
    repoRoot,
    imageUrl: body?.url,
    description: body?.description || '',
    tags: body?.tags || [],
    photographer: body?.photographer || '',
    context: body?.context || null,
    langs: body?.langs,
    vendor: 'openai',
  });
  serveJson(res, 200, { alts: out.alts });
  return true;
}

// GET /api/image-library/:id/usage - Where an image is used
async function handleImageUsage({ storageScope, res }, imageId) {
  const item = await getImageLibraryItem(storageScope, imageId);
  if (!item) return notFound(res);
  const usage = await getImageLibraryUsage(storageScope, item.url);
  serveJson(res, 200, {
    id: item.id,
    url: item.url,
    usage,
  });
  return true;
}

// POST /api/image-library/:id/generate-alts - Generate alt texts for a library
// item
async function handleItemGenerateAlts(
  { repoRoot, storageScope, req, res, authedUser },
  imageId,
) {
  if (!authedUser) return unauthorized(res, 'Login required');
  if (!getFeatureFlags().aiAltText)
    return forbidden(res, 'AI alt text is not enabled');
  const item = await getImageLibraryItem(storageScope, imageId);
  if (!item) return notFound(res);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const out = await generateImageAltTexts({
    repoRoot,
    imageUrl: item.url,
    description: item.description || '',
    tags: item.tags || [],
    photographer: item.photographer || '',
    context: body?.context || null,
    langs: body?.langs,
    vendor: 'openai',
  });
  serveJson(res, 200, { alts: out.alts });
  return true;
}

// POST /api/image-library/:id/replace-upload - Replace a local upload in place
async function handleReplaceUpload(
  { repoRoot, storageScope, req, res, authedUser },
  imageId,
) {
  const flags = getFeatureFlags();
  if (flags.demoMode || flags.sandboxMode)
    return methodNotAllowed(res, ['GET']);
  if (!authedUser) return unauthorized(res, 'Login required');

  const item = await getImageLibraryItem(storageScope, imageId);
  if (!item) return notFound(res);
  if (!String(item.url || '').startsWith('/uploads/')) {
    return badRequest(
      res,
      'This image is not stored as a local upload (/uploads/...), so it cannot be replaced in-place.',
    );
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const dataUrl = getDataUrl(body, 'dataUrl');
  if (!dataUrl) {
    return badRequest(res, 'Expected { dataUrl: "data:<mime>;base64,..." }');
  }

  await replaceUploadFromDataUrl(repoRoot, item.url, dataUrl);
  const updated = await updateImageLibraryItem(storageScope, imageId, {});
  if (!updated.ok) return notFound(res);
  serveJson(
    res,
    200,
    await withFavorite(storageScope, authedUser, updated.image),
  );
  return true;
}

// POST /api/image-library/:id/favorite - Toggle favorite status
async function handleToggleFavorite(
  { storageScope, res, authedUser },
  imageId,
) {
  if (!authedUser) return unauthorized(res, 'Login required');

  const item = await getImageLibraryItem(storageScope, imageId);
  if (!item) return notFound(res);

  const favorite = await toggleImageFavorite(
    storageScope,
    imageId,
    authedUser.email,
  );
  serveJson(res, 200, { id: imageId, favorite });
  return true;
}

// GET /api/image-library/:id - One item
async function handleGetImageItem({ storageScope, res, authedUser }, imageId) {
  const item = await getImageLibraryItem(storageScope, imageId);
  if (!item) return notFound(res);
  serveJson(res, 200, await withFavorite(storageScope, authedUser, item));
  return true;
}

// PUT /api/image-library/:id - Update one item
async function handleUpdateImageItem(
  { storageScope, req, res, authedUser },
  imageId,
) {
  const flags = getFeatureFlags();
  if (flags.demoMode || flags.sandboxMode)
    return methodNotAllowed(res, ['GET']);
  if (!authedUser) return unauthorized(res, 'Login required');
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const updated = await updateImageLibraryItem(storageScope, imageId, body);
  if (!updated.ok) return notFound(res);
  serveJson(
    res,
    200,
    await withFavorite(storageScope, authedUser, updated.image),
  );
  return true;
}

// DELETE /api/image-library/:id - Delete one item
async function handleDeleteImageItem(
  { storageScope, res, authedUser },
  imageId,
) {
  const flags = getFeatureFlags();
  if (flags.demoMode || flags.sandboxMode)
    return methodNotAllowed(res, ['GET']);
  // The library is organization-scoped, so the delete is too: an instance
  // admin who is a plain member of the active organization may not throw
  // away its images (shared/organization-role.js).
  if (!isOrganizationAdmin(authedUser)) return forbidden(res, 'Admin required');
  const deleted = await deleteImageLibraryItem(storageScope, imageId);
  if (!deleted.ok) return notFound(res);
  serveJson(res, 200, { ok: true });
  return true;
}

/**
 * Declarative route table for `/api/image-library*` (A7.19 C8), Form B: one
 * row per method plus a catch-all `405` row per path. Order is load-bearing:
 * the exact `/generate-alts` rows come before the `/:id` regex, which would
 * otherwise swallow that path. Whether the library exists at all is the
 * mount's `feature: 'imageLibrary'` (`routes/api/index.js`), not a check here.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/image-library',
    handler: handleListImageLibrary,
  },
  {
    method: 'POST',
    pattern: '/api/image-library',
    handler: handleCreateImageLibraryItem,
  },
  {
    pattern: '/api/image-library',
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']),
  },
  {
    method: 'POST',
    pattern: '/api/image-library/generate-alts',
    handler: handleGenerateAltsPreview,
    feature: 'ai',
  },
  {
    pattern: '/api/image-library/generate-alts',
    handler: ({ res }) => methodNotAllowed(res, ['POST']),
    feature: 'ai',
  },
  {
    method: 'GET',
    pattern: /^\/api\/image-library\/([^/]+)\/usage$/,
    captures: ['uuid'],
    handler: handleImageUsage,
  },
  {
    pattern: /^\/api\/image-library\/([^/]+)\/usage$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
  {
    method: 'POST',
    pattern: /^\/api\/image-library\/([^/]+)\/generate-alts$/,
    captures: ['uuid'],
    handler: handleItemGenerateAlts,
    feature: 'ai',
  },
  {
    pattern: /^\/api\/image-library\/([^/]+)\/generate-alts$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['POST']),
    feature: 'ai',
  },
  {
    method: 'POST',
    pattern: /^\/api\/image-library\/([^/]+)\/replace-upload$/,
    captures: ['uuid'],
    handler: handleReplaceUpload,
  },
  {
    pattern: /^\/api\/image-library\/([^/]+)\/replace-upload$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['POST']),
  },
  {
    method: 'POST',
    pattern: /^\/api\/image-library\/([^/]+)\/favorite$/,
    captures: ['uuid'],
    handler: handleToggleFavorite,
  },
  {
    pattern: /^\/api\/image-library\/([^/]+)\/favorite$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['POST']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/image-library\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleGetImageItem,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/image-library\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleUpdateImageItem,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/image-library\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleDeleteImageItem,
  },
  {
    pattern: /^\/api\/image-library\/([^/]+)$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PUT', 'DELETE']),
  },
];

/**
 * Handle image-library API routes. No module-wide guard: the per-path
 * guards (demo/sandbox stance, auth) stay in the handlers, and the library's
 * on/off is the mount's `feature`.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleImageLibrary = withErrorHandler('image-library', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
