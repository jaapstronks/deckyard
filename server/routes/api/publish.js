import {
  newPublishId,
  removePublishedEntry,
  updatePublishedSlug,
  upsertPublishedEntry,
} from '../../storage/published.js';
import { getPresentation, updatePresentation } from '../../storage/presentations.js';
import { readUserSettings } from '../../storage/settings.js';
import { pickOgImageUrlFromPresentation } from '../../render/og-image.js';
import { serveJson, json } from '../../utils/http.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { withPresentationAuth } from '../../utils/route-middleware.js';
import { maybeFireWebhook } from '../../utils/webhooks.js';
import { loadTheme } from '../../utils/themes.js';
import { generateAndSaveOgPreview } from '../../render/preview-image.js';
import { isMediaProviderInitialized } from '../../media/index.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('publish');

export async function handlePublish({ repoRoot, req, res, url, authedUser }) {
  // Publish (public share link)
  const publishMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/publish$/
  );
  if (publishMatch && req.method === 'POST') {
    const id = publishMatch[1];

    // Sandbox stance: no public published URLs. A guest owns their own private
    // deck and could otherwise publish arbitrary content onto the public
    // domain. Mirrors canChangePresentationScope() returning false in sandbox.
    if (sandboxEnabled()) {
      serveJson(res, 403, { error: 'Publishing is disabled in sandbox mode' });
      return true;
    }

    const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const publishId =
      typeof pres?.published?.id === 'string' && pres.published.id
        ? pres.published.id
        : newPublishId();

    // Generate OG preview image from the first meaningful slide
    let ogImageUrl = '/assets/images/slides-previewimage.png';
    try {
      // Find first slide that's not a follow-invite-slide (those are internal)
      const firstSlide = Array.isArray(pres?.slides)
        ? pres.slides.find((s) => s?.type !== 'follow-invite-slide')
        : null;

      if (firstSlide && isMediaProviderInitialized()) {
        const theme = await loadTheme(repoRoot, pres.theme);

        // Check if author overlay should be shown
        const showAuthor = pres?.settings?.ogPreview?.showAuthor === true;
        let authorInfo = null;

        if (showAuthor) {
          const ownerEmail = pres?.ownerEmail || pres?.createdBy || authedUser?.email;
          if (ownerEmail) {
            try {
              const userSettings = await readUserSettings(repoRoot, ownerEmail);
              authorInfo = {
                name: userSettings?.profile?.name || ownerEmail.split('@')[0],
                imageUrl: userSettings?.profile?.imageUrl || '',
              };
            } catch {
              // Fall back to email-derived name
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
        // Fall back to picking an image from presentation content
        ogImageUrl = pickOgImageUrlFromPresentation(pres) || ogImageUrl;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      log.warn('[publish] Preview generation failed:', err.message);
      // Fall back to existing behavior
      ogImageUrl = pickOgImageUrlFromPresentation(pres) || ogImageUrl;
    }

    const entry = await upsertPublishedEntry(repoRoot, {
      publishId,
      presentationId: pres.id,
      title: pres.title,
      ogImageUrl,
    });

    // Persist back onto the presentation document as well (handy for exports/UI).
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
      actorEmail: authedUser?.email || null,
    });

    await maybeFireWebhook(repoRoot, req, {
      event: 'presentation.published',
      pres: nextPres,
      authedUser,
      extra: {
        publishId: entry.publishId,
        slug: entry.slug,
        path: `/p/${entry.publishId}-${entry.slug}`,
        ogImageUrl: entry.ogImageUrl || '',
      },
    });

    serveJson(res, 200, {
      publishId: entry.publishId,
      slug: entry.slug,
      path: `/p/${entry.publishId}-${entry.slug}`,
      ogImageUrl: entry.ogImageUrl || '',
    });
    return true;
  }

  // Depublish (disable public link)
  if (publishMatch && req.method === 'DELETE') {
    const id = publishMatch[1];
    const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const publishId = String(pres?.published?.id || '').trim();
    if (publishId) await removePublishedEntry(repoRoot, publishId);

    const nextPres = { ...pres };
    delete nextPres.published;
    await updatePresentation(repoRoot, id, nextPres, {
      actorEmail: authedUser?.email || null,
    });

    serveJson(res, 200, { ok: true });
    return true;
  }

  // Update published slug (cosmetic, but controls canonical URL)
  const slugMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/publish\/slug$/
  );
  if (slugMatch && req.method === 'PATCH') {
    const id = slugMatch[1];
    const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const publishId = String(pres?.published?.id || '').trim();
    if (!publishId) {
      serveJson(res, 400, { error: 'Not published' });
      return true;
    }

    let body = {};
    try {
      body = (await json(req)) || {};
    } catch (err) {
      if (err?.statusCode === 413) {
        serveJson(res, 413, { error: 'Request body too large' });
        return true;
      }
      body = {};
    }
    const nextSlug = body?.slug;
    const entry = await updatePublishedSlug(repoRoot, publishId, nextSlug);

    const nextPres = {
      ...pres,
      published: {
        ...(pres.published && typeof pres.published === 'object' ? pres.published : {}),
        id: publishId,
        slug: entry.slug,
        modified: entry.modified,
      },
    };
    await updatePresentation(repoRoot, id, nextPres, {
      actorEmail: authedUser?.email || null,
    });

    serveJson(res, 200, {
      publishId,
      slug: entry.slug,
      path: `/p/${publishId}-${entry.slug}`,
    });
    return true;
  }

  // Regenerate preview image for an already-published presentation
  const previewMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/preview\/regenerate$/
  );
  if (previewMatch && req.method === 'POST') {
    const id = previewMatch[1];
    const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
    if (!pres) return true;

    const publishId = String(pres?.published?.id || '').trim();
    if (!publishId) {
      serveJson(res, 400, { error: 'Not published' });
      return true;
    }

    if (!isMediaProviderInitialized()) {
      serveJson(res, 500, { error: 'Media provider not available' });
      return true;
    }

    // Find first meaningful slide
    const firstSlide = Array.isArray(pres?.slides)
      ? pres.slides.find((s) => s?.type !== 'follow-invite-slide')
      : null;

    if (!firstSlide) {
      serveJson(res, 400, { error: 'No slides to preview' });
      return true;
    }

    try {
      const theme = await loadTheme(repoRoot, pres.theme);

      // Check if author overlay should be shown
      const showAuthor = pres?.settings?.ogPreview?.showAuthor === true;
      let authorInfo = null;

      if (showAuthor) {
        const ownerEmail = pres?.ownerEmail || pres?.createdBy || authedUser?.email;
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

      const ogImageUrl = await generateAndSaveOgPreview(
        repoRoot,
        firstSlide,
        theme,
        `og-${publishId}`,
        { showAuthor, authorInfo }
      );

      // Update the published entry
      await upsertPublishedEntry(repoRoot, {
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
      await updatePresentation(repoRoot, id, nextPres, {
        actorEmail: authedUser?.email || null,
      });

      serveJson(res, 200, { ok: true, ogImageUrl });
    } catch (err) {
      // eslint-disable-next-line no-console
      log.error('[publish] Preview regeneration failed:', err);
      serveJson(res, 500, { error: 'Preview generation failed' });
    }
    return true;
  }

  return false;
}
