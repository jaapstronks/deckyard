import {
  badRequest,
  json,
  methodNotAllowed,
  serveJson,
  unauthorized,
  notFound,
} from '../../utils/http.js';
import {
  createPersonalLibraryItem,
  createTeamLibraryItem,
  deletePersonalLibraryItem,
  deleteTeamLibraryItem,
  listPersonalLibrary,
  listTeamLibrary,
  updatePersonalLibraryItem,
  updateTeamLibraryItem,
  setTeamLibraryItemTrashed,
  getTagsForSlideLibraryItem,
  getTagsForSlideLibraryItems,
  setTagsForSlideLibraryItem,
} from '../../storage/slide-library.js';
import {
  listSlideLibraryUsage,
  recordSlideLibraryUsage,
} from '../../storage/slide-library-usage.js';
import { maybeFireWebhook } from '../../utils/webhooks.js';
import { loadTheme } from '../../utils/themes.js';
import { generateAndSaveOgPreview } from '../../render/preview-image.js';
import { isMediaProviderInitialized } from '../../media/index.js';

function cleanThemeId(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.slice(0, 80);
}

export async function handleSlideLibrary({ repoRoot, req, res, url, authedUser }) {
  if (!url.pathname.startsWith('/api/slide-library')) return false;
  if (!authedUser) return unauthorized(res);

  const themeId = cleanThemeId(url.searchParams.get('theme') || '');
  const email = String(authedUser?.email || '').trim().toLowerCase();

  // Per-user usage ("new to you" tracking). GET returns the current user's set
  // of used {itemType, itemId}; POST records usage from the insert-into-existing
  // path (compose records server-side in the create handler instead).
  if (url.pathname === '/api/slide-library/usage') {
    if (req.method === 'GET') {
      const out = await listSlideLibraryUsage(repoRoot, email);
      serveJson(res, 200, out);
      return true;
    }
    if (req.method === 'POST') {
      const body = await json(req);
      const r = await recordSlideLibraryUsage(repoRoot, email, body?.items);
      serveJson(res, 200, { ok: true, recorded: r?.recorded || 0 });
      return true;
    }
    return methodNotAllowed(res);
  }

  // Personal library
  if (url.pathname === '/api/slide-library/personal') {
    if (req.method === 'GET') {
      const out = await listPersonalLibrary(repoRoot, email, { themeId });
      // Attach tags to each item
      if (Array.isArray(out?.items) && out.items.length > 0) {
        const ids = out.items.map((it) => it.id);
        const tagsMap = await getTagsForSlideLibraryItems(ids, { userEmail: email });
        for (const item of out.items) {
          item.tags = tagsMap.get(item.id) || [];
        }
      }
      serveJson(res, 200, out);
      return true;
    }
    if (req.method === 'POST') {
      const body = await json(req);
      const r = await createPersonalLibraryItem(repoRoot, email, body, {
        actorEmail: email,
      });
      if (!r.ok) return badRequest(res, r.reason);
      serveJson(res, 201, r.item);
      return true;
    }
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  const personalIdMatch = url.pathname.match(/^\/api\/slide-library\/personal\/([^/]+)$/);
  if (personalIdMatch) {
    const id = personalIdMatch[1];
    if (req.method === 'PATCH') {
      const body = await json(req);
      const r = await updatePersonalLibraryItem(repoRoot, email, id, body, {
        actorEmail: email,
      });
      if (!r.ok) return r.reason === 'not_found' ? notFound(res) : badRequest(res, r.reason);
      serveJson(res, 200, r.item);
      return true;
    }
    if (req.method === 'DELETE') {
      const r = await deletePersonalLibraryItem(repoRoot, email, id);
      if (!r.ok) return notFound(res);
      serveJson(res, 200, { ok: true });
      return true;
    }
    return methodNotAllowed(res, ['PATCH', 'DELETE']);
  }

  // Team library (workspace-wide)
  if (url.pathname === '/api/slide-library/team') {
    if (req.method === 'GET') {
      const out = await listTeamLibrary(repoRoot, { themeId, userEmail: email });
      // Attach tags to each item
      if (Array.isArray(out?.items) && out.items.length > 0) {
        const ids = out.items.map((it) => it.id);
        const tagsMap = await getTagsForSlideLibraryItems(ids, { userEmail: email });
        for (const item of out.items) {
          item.tags = tagsMap.get(item.id) || [];
        }
      }
      serveJson(res, 200, out);
      return true;
    }
    if (req.method === 'POST') {
      const body = await json(req);
      const r = await createTeamLibraryItem(repoRoot, body, { actorEmail: email });
      if (!r.ok) return badRequest(res, r.reason);

      // Generate preview image for the slide library item
      let previewUrl = null;
      try {
        if (isMediaProviderInitialized()) {
          // Create a mock slide object from the library item
          const mockSlide = {
            id: r.item.id,
            type: r.item.slideType,
            content: r.item.content,
          };
          const theme = await loadTheme(repoRoot, r.item.themeId);
          previewUrl = await generateAndSaveOgPreview(
            repoRoot,
            mockSlide,
            theme,
            `lib-${r.item.id}`
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[slide-library] Preview generation failed:', err.message);
      }

      // Fire webhook for team library addition (reuses workspace share webhook URL)
      void maybeFireWebhook(repoRoot, req, {
        event: 'slide.added_to_team_library',
        slideItem: { ...r.item, previewUrl },
        authedUser,
      });

      serveJson(res, 201, { ...r.item, previewUrl });
      return true;
    }
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  const teamIdMatch = url.pathname.match(/^\/api\/slide-library\/team\/([^/]+)$/);
  if (teamIdMatch) {
    const id = teamIdMatch[1];
    if (req.method === 'PATCH') {
      const body = await json(req);
      // Permission model:
      // - Favorites are per-user and always allowed for authed users.
      // - Trashing (soft delete) is restricted to admins or the creator.
      if (body && typeof body === 'object' && 'trashed' in body) {
        const r = await setTeamLibraryItemTrashed(repoRoot, id, {
          trashed: !!body.trashed,
          actorEmail: email,
          allowTrash: (item, { actorEmail }) => {
            if (authedUser?.isAdmin) return true;
            return String(item?.createdBy || '').toLowerCase() === String(actorEmail || '').toLowerCase();
          },
        });
        if (!r.ok) {
          if (r.reason === 'not_found') return notFound(res);
          if (r.reason === 'forbidden') return unauthorized(res, 'Not allowed');
          return badRequest(res, r.reason);
        }
        serveJson(res, 200, r.item);
        return true;
      }

      const r = await updateTeamLibraryItem(repoRoot, id, body, { actorEmail: email });
      if (!r.ok) return r.reason === 'not_found' ? notFound(res) : badRequest(res, r.reason);
      serveJson(res, 200, r.item);
      return true;
    }
    if (req.method === 'DELETE') {
      const r = await deleteTeamLibraryItem(repoRoot, id, {
        actorEmail: email,
        allowDelete: (item, { actorEmail }) => {
          // Conservative policy:
          // - admins can delete
          // - otherwise only the creator can delete
          if (authedUser?.isAdmin) return true;
          return String(item?.createdBy || '').toLowerCase() === String(actorEmail || '').toLowerCase();
        },
      });
      if (!r.ok) {
        if (r.reason === 'not_found') return notFound(res);
        if (r.reason === 'forbidden') return unauthorized(res, 'Not allowed');
        return badRequest(res, r.reason);
      }
      serveJson(res, 200, { ok: true });
      return true;
    }
    return methodNotAllowed(res, ['PATCH', 'DELETE']);
  }

  // Personal library item tags
  const personalTagsMatch = url.pathname.match(/^\/api\/slide-library\/personal\/([^/]+)\/tags$/);
  if (personalTagsMatch) {
    const id = personalTagsMatch[1];
    if (req.method === 'GET') {
      const tags = await getTagsForSlideLibraryItem(id, { userEmail: email });
      serveJson(res, 200, tags);
      return true;
    }
    if (req.method === 'PUT') {
      const body = await json(req);
      const tagNames = Array.isArray(body) ? body : (body?.tags || []);
      const tags = await setTagsForSlideLibraryItem(id, tagNames, { userEmail: email });
      serveJson(res, 200, tags);
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  // Team library item tags
  const teamTagsMatch = url.pathname.match(/^\/api\/slide-library\/team\/([^/]+)\/tags$/);
  if (teamTagsMatch) {
    const id = teamTagsMatch[1];
    if (req.method === 'GET') {
      const tags = await getTagsForSlideLibraryItem(id, { userEmail: email });
      serveJson(res, 200, tags);
      return true;
    }
    if (req.method === 'PUT') {
      const body = await json(req);
      const tagNames = Array.isArray(body) ? body : (body?.tags || []);
      const tags = await setTagsForSlideLibraryItem(id, tagNames, { userEmail: email });
      serveJson(res, 200, tags);
      return true;
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  return false;
}
