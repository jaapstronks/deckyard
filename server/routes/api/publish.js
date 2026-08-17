import {
  removePublishedEntry,
  updatePublishedSlug,
  upsertPublishedEntry,
} from '../../storage/published/index.js';
import { updatePresentation } from '../../storage/presentations/index.js';
import { getUserSettings } from '../../storage/settings.js';
import { serveJson, serverError, badRequest, requireJsonBody, withErrorHandler } from '../../utils/http.js';
import { withPresentationAuth } from '../../utils/route-middleware.js';
import { loadThemeAssets } from '../../utils/themes.js';
import { generateAndSaveOgPreview } from '../../render/preview-image.js';
import { isMediaProviderInitialized } from '../../media/index.js';
import { publishPresentation, assertPublishingEnabled } from '../../services/publish-presentation.js';
import { createLogger } from '../../utils/logger.js';
import { dispatchRoutes } from '../../utils/router.js';
const log = createLogger('publish');

// POST /api/presentations/:id/publish — publish (public share link)
async function handlePublishCreate({ repoRoot, storageScope, req, res, authedUser }, id) {
  // Refuse in sandbox before loading the deck (the shared policy gate).
  assertPublishingEnabled();

  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  // The publish flow (sandbox refusal, OG preview, entry upsert, thumbnail
  // warm, webhook) is shared with the v1 route — one canonical form.
  const result = await publishPresentation({ repoRoot, storageScope, req, pres, actor: authedUser });
  serveJson(res, 200, result);
  return true;
}

// DELETE /api/presentations/:id/publish — depublish (disable public link)
async function handlePublishDelete({ storageScope, res, authedUser }, id) {
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const publishId = String(pres?.published?.id || '').trim();
  if (publishId) await removePublishedEntry(storageScope, publishId);

  // Explicit null, not a deleted key: the storage layer reads an absent key
  // as "leave this column alone", so dropping it would keep the deck
  // published in the database.
  const nextPres = { ...pres, published: null };
  await updatePresentation(storageScope, id, nextPres, {
    actorEmail: authedUser?.email || null,
  });

  serveJson(res, 200, { ok: true });
  return true;
}

// PATCH /api/presentations/:id/publish/slug — update published slug (cosmetic,
// but controls the canonical URL)
async function handlePublishSlug({ storageScope, req, res, authedUser }, id) {
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const publishId = String(pres?.published?.id || '').trim();
  if (!publishId) {
    badRequest(res, 'Not published');
    return true;
  }

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const nextSlug = parsed.body?.slug;
  const entry = await updatePublishedSlug(storageScope, publishId, nextSlug);

  const nextPres = {
    ...pres,
    published: {
      ...(pres.published && typeof pres.published === 'object' ? pres.published : {}),
      id: publishId,
      slug: entry.slug,
      modified: entry.modified,
    },
  };
  await updatePresentation(storageScope, id, nextPres, {
    actorEmail: authedUser?.email || null,
  });

  serveJson(res, 200, {
    publishId,
    slug: entry.slug,
    path: `/p/${publishId}-${entry.slug}`,
  });
  return true;
}

// POST /api/presentations/:id/preview/regenerate — regenerate the preview image
// for an already-published presentation
async function handlePreviewRegenerate({ repoRoot, storageScope, res, authedUser }, id) {
  const pres = await withPresentationAuth({ storageScope, id, authedUser, res, permission: 'write' });
  if (!pres) return true;

  const publishId = String(pres?.published?.id || '').trim();
  if (!publishId) {
    badRequest(res, 'Not published');
    return true;
  }

  if (!isMediaProviderInitialized()) {
    serverError(res, 'Media provider not available');
    return true;
  }

  // Find first meaningful slide
  const firstSlide = Array.isArray(pres?.slides)
    ? pres.slides.find((s) => s?.type !== 'follow-invite-slide')
    : null;

  if (!firstSlide) {
    badRequest(res, 'No slides to preview');
    return true;
  }

  try {
    const theme = await loadThemeAssets(repoRoot, pres.theme);

    // Check if author overlay should be shown
    const showAuthor = pres?.settings?.ogPreview?.showAuthor === true;
    let authorInfo = null;

    if (showAuthor) {
      const ownerEmail = pres?.ownerEmail || pres?.createdBy || authedUser?.email;
      if (ownerEmail) {
        try {
          const userSettings = await getUserSettings(storageScope, ownerEmail);
          authorInfo = {
            name: userSettings?.profile?.name || ownerEmail.split('@')[0],
            imageUrl: userSettings?.profile?.imageUrl || '',
          };
        } catch {
          authorInfo = { name: ownerEmail.split('@')[0], imageUrl: '' };
        }
      }
    }

    const ogImageUrl = await generateAndSaveOgPreview(
      repoRoot,
      firstSlide,
      theme,
      `og-${publishId}`,
      { showAuthor, authorInfo }
    );

    // Update the published entry
    await upsertPublishedEntry(storageScope, {
      publishId,
      presentationId: pres.id,
      title: pres.title,
      ogImageUrl,
    });

    // Update the presentation document
    const nextPres = {
      ...pres,
      published: {
        ...(pres.published && typeof pres.published === 'object' ? pres.published : {}),
        ogImageUrl,
      },
    };
    await updatePresentation(storageScope, id, nextPres, {
      actorEmail: authedUser?.email || null,
    });

    serveJson(res, 200, { ok: true, ogImageUrl });
  } catch (err) {
    // eslint-disable-next-line no-console
    log.error('[publish] Preview regeneration failed:', err);
    serverError(res, 'Preview generation failed');
  }
  return true;
}

/**
 * Declarative route table for the publish/preview endpoints (A7.19 C8). Order
 * matches the previous if-chain; the two `publish$` routes share one pattern
 * and split on method. Method mismatch falls through (the chain had no 405).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'POST', pattern: /^\/api\/presentations\/([^/]+)\/publish$/, handler: handlePublishCreate },
  { method: 'DELETE', pattern: /^\/api\/presentations\/([^/]+)\/publish$/, handler: handlePublishDelete },
  { method: 'PATCH', pattern: /^\/api\/presentations\/([^/]+)\/publish\/slug$/, handler: handlePublishSlug },
  { method: 'POST', pattern: /^\/api\/presentations\/([^/]+)\/preview\/regenerate$/, handler: handlePreviewRegenerate },
];

/**
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handlePublish = withErrorHandler('publish', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
