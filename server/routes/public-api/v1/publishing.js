/**
 * Public API v1 - Publishing endpoints.
 * Handles publish/unpublish operations for presentations.
 */

import {
  newPublishId,
  removePublishedEntry,
  upsertPublishedEntry,
} from '../../../storage/published.js';
import { updatePresentation } from '../../../storage/presentations.js';
import { readUserSettings } from '../../../storage/settings.js';
import { pickOgImageUrlFromPresentation } from '../../../render/og-image.js';
import { methodNotAllowed } from '../../../utils/http.js';
import { loadTheme } from '../../../utils/themes.js';
import { generateAndSaveOgPreview } from '../../../render/preview-image.js';
import { isMediaProviderInitialized } from '../../../media/index.js';
import { requireScope, getPresentationWithAccess, apiSuccess, apiError } from './middleware.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * POST /api/v1/presentations/:id/publish - Publish a presentation.
 */
async function handlePublish(ctx, id) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id, { access: 'write' });
  if (!ok) return true;

  // Generate or reuse publish ID
  const publishId =
    typeof pres?.published?.id === 'string' && pres.published.id
      ? pres.published.id
      : newPublishId();

  // Generate OG preview image from the first meaningful slide
  let ogImageUrl = '/assets/images/slides-previewimage.png';
  try {
    const firstSlide = Array.isArray(pres?.slides)
      ? pres.slides.find((s) => s?.type !== 'follow-invite-slide')
      : null;

    if (firstSlide && isMediaProviderInitialized()) {
      const theme = await loadTheme(repoRoot, pres.theme);

      // Check if author overlay should be shown
      const showAuthor = pres?.settings?.ogPreview?.showAuthor === true;
      let authorInfo = null;

      if (showAuthor) {
        const ownerEmail = pres?.ownerEmail || pres?.createdBy || apiKey.ownerEmail;
        if (ownerEmail) {
          try {
            const userSettings = await readUserSettings(repoRoot, ownerEmail);
            authorInfo = {
              name: userSettings?.profile?.name || ownerEmail.split('@')[0],
              imageUrl: userSettings?.profile?.imageUrl || '',
            };
          } catch {
            authorInfo = { name: ownerEmail.split('@')[0], imageUrl: '' };
          }
        }
      }

      ogImageUrl = await generateAndSaveOgPreview(
        repoRoot,
        firstSlide,
        theme,
        `og-${publishId}`,
        { showAuthor, authorInfo }
      );
    } else {
      ogImageUrl = pickOgImageUrlFromPresentation(pres) || ogImageUrl;
    }
  } catch (err) {
    // Fall back to existing behavior
    ogImageUrl = pickOgImageUrlFromPresentation(pres) || ogImageUrl;
  }

  // Upsert published entry
  const entry = await upsertPublishedEntry(repoRoot, {
    publishId,
    presentationId: pres.id,
    title: pres.title,
    ogImageUrl,
  });

  // Persist onto the presentation document
  const nextPres = {
    ...pres,
    published: {
      id: entry.publishId,
      slug: entry.slug,
      ogImageUrl: entry.ogImageUrl || '',
      created: entry.created,
      modified: entry.modified,
    },
  };
  await updatePresentation(repoRoot, id, nextPres, {
    actorEmail: apiKey.ownerEmail,
  });

  await apiSuccess(ctx, {
    publishId: entry.publishId,
    slug: entry.slug,
    path: `/p/${entry.publishId}-${entry.slug}`,
    ogImageUrl: entry.ogImageUrl || '',
  });
  return true;
}

/**
 * GET /api/v1/presentations/:id/publish - Get publish status.
 */
async function handleGetPublishStatus(ctx, id) {
  if (!requireScope(ctx, 'read')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id);
  if (!ok) return true;

  const published = pres?.published;
  if (!published || typeof published.id !== 'string' || !published.id) {
    await apiSuccess(ctx, {
      isPublished: false,
    });
    return true;
  }

  await apiSuccess(ctx, {
    isPublished: true,
    publishId: published.id,
    slug: published.slug || '',
    path: `/p/${published.id}-${published.slug || ''}`,
    ogImageUrl: published.ogImageUrl || '',
    publishedAt: published.created || null,
  });
  return true;
}

/**
 * DELETE /api/v1/presentations/:id/publish - Unpublish a presentation.
 */
async function handleUnpublish(ctx, id) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'write')) return true;

  const { ok, pres } = await getPresentationWithAccess(ctx, id, { access: 'write' });
  if (!ok) return true;

  const publishId = String(pres?.published?.id || '').trim();
  if (publishId) {
    await removePublishedEntry(repoRoot, publishId);
  }

  const nextPres = { ...pres };
  delete nextPres.published;
  await updatePresentation(repoRoot, id, nextPres, {
    actorEmail: apiKey.ownerEmail,
  });

  await apiSuccess(ctx, { unpublished: true });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Main handler for /api/v1/presentations/:id/publish routes.
 */
export async function handlePublishing(ctx) {
  const { req, res, url } = ctx;

  const publishMatch = url.pathname.match(
    /^\/api\/v1\/presentations\/([^/]+)\/publish$/
  );
  if (!publishMatch) {
    return false;
  }

  const id = publishMatch[1];

  if (req.method === 'POST') return handlePublish(ctx, id);
  if (req.method === 'GET') return handleGetPublishStatus(ctx, id);
  if (req.method === 'DELETE') return handleUnpublish(ctx, id);

  return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
}
