import {
  badRequest,
  forbidden,
  methodNotAllowed,
  serveJson,
  unauthorized,
  notFound,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import {
  createPersonalLibraryItem,
  createOrganizationLibraryItem,
  deletePersonalLibraryItem,
  deleteOrganizationLibraryItem,
  listPersonalLibrary,
  listOrganizationLibrary,
  updatePersonalLibraryItem,
  updateOrganizationLibraryItem,
  setOrganizationLibraryItemTrashed,
  getTagsForSlideLibraryItem,
  getTagsForSlideLibraryItems,
  setTagsForSlideLibraryItem,
} from '../../storage/slide-library/index.js';
import {
  listSlideLibraryUsage,
  recordSlideLibraryUsage,
} from '../../storage/slide-library-usage/index.js';
import { maybeFireWebhook } from '../../utils/webhooks.js';
import { loadThemeAssets } from '../../utils/themes.js';
import { generateAndSaveOgPreview } from '../../render/preview-image.js';
import { isMediaProviderInitialized } from '../../media/index.js';
import { dispatchRoutes } from '../../utils/router.js';
import { createLogger } from '../../utils/logger.js';
import { matchesIdentity } from '../../../shared/identity-match.js';
const log = createLogger('slide-library');

function cleanThemeId(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.slice(0, 80);
}

function actorEmail(authedUser) {
  return String(authedUser?.email || '')
    .trim()
    .toLowerCase();
}

// GET /api/slide-library/usage - Per-user usage ("new to you" tracking):
// the current user's set of used {itemType, itemId}
async function handleUsageList({ storageScope, res, authedUser }) {
  const out = await listSlideLibraryUsage(storageScope, actorEmail(authedUser));
  serveJson(res, 200, out);
  return true;
}

// POST /api/slide-library/usage - Record usage from the insert-into-existing
// path (compose records server-side in the create handler instead)
async function handleUsageRecord({ storageScope, req, res, authedUser }) {
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await recordSlideLibraryUsage(
    storageScope,
    actorEmail(authedUser),
    body?.items,
  );
  serveJson(res, 200, { ok: true, recorded: r?.recorded || 0 });
  return true;
}

// GET /api/slide-library/personal - List the personal library
async function handlePersonalList({ storageScope, res, url, authedUser }) {
  const email = actorEmail(authedUser);
  const themeId = cleanThemeId(url.searchParams.get('theme') || '');
  const out = await listPersonalLibrary(storageScope, email, { themeId });
  // Attach tags to each item
  if (Array.isArray(out?.items) && out.items.length > 0) {
    const ids = out.items.map((it) => it.id);
    const tagsMap = await getTagsForSlideLibraryItems(storageScope, ids, {
      userEmail: email,
    });
    for (const item of out.items) {
      item.tags = tagsMap.get(item.id) || [];
    }
  }
  serveJson(res, 200, out);
  return true;
}

// POST /api/slide-library/personal - Save a slide to the personal library
async function handlePersonalCreate({ storageScope, req, res, authedUser }) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await createPersonalLibraryItem(storageScope, email, body, {
    actorEmail: email,
  });
  if (!r.ok) return badRequest(res, r.reason);
  serveJson(res, 201, r.item);
  return true;
}

// PATCH /api/slide-library/personal/:id - Update a personal item
async function handlePersonalUpdate(
  { storageScope, req, res, authedUser },
  id,
) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await updatePersonalLibraryItem(storageScope, email, id, body, {
    actorEmail: email,
  });
  if (!r.ok)
    return r.reason === 'not_found' ? notFound(res) : badRequest(res, r.reason);
  serveJson(res, 200, r.item);
  return true;
}

// DELETE /api/slide-library/personal/:id - Delete a personal item
async function handlePersonalDelete({ storageScope, res, authedUser }, id) {
  const r = await deletePersonalLibraryItem(
    storageScope,
    actorEmail(authedUser),
    id,
  );
  if (!r.ok) return notFound(res);
  serveJson(res, 200, { ok: true });
  return true;
}

// GET /api/slide-library/organization - List the organization-wide library
async function handleOrganizationList({ storageScope, res, url, authedUser }) {
  const email = actorEmail(authedUser);
  const themeId = cleanThemeId(url.searchParams.get('theme') || '');
  const out = await listOrganizationLibrary(storageScope, {
    themeId,
    userEmail: email,
  });
  // Attach tags to each item
  if (Array.isArray(out?.items) && out.items.length > 0) {
    const ids = out.items.map((it) => it.id);
    const tagsMap = await getTagsForSlideLibraryItems(storageScope, ids, {
      userEmail: email,
    });
    for (const item of out.items) {
      item.tags = tagsMap.get(item.id) || [];
    }
  }
  serveJson(res, 200, out);
  return true;
}

// POST /api/slide-library/organization - Save a slide to the organization library
async function handleOrganizationCreate({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
}) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const r = await createOrganizationLibraryItem(storageScope, body, {
    actorEmail: email,
  });
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
      const theme = await loadThemeAssets(repoRoot, r.item.themeId);
      previewUrl = await generateAndSaveOgPreview(
        repoRoot,
        mockSlide,
        theme,
        `lib-${r.item.id}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    log.warn('[slide-library] Preview generation failed:', err.message);
  }

  // Fire webhook for organization-library addition (reuses organization share webhook URL)
  void maybeFireWebhook(repoRoot, req, {
    event: 'slide.added_to_organization_library',
    slideItem: { ...r.item, previewUrl },
    authedUser,
  });

  serveJson(res, 201, { ...r.item, previewUrl });
  return true;
}

// PATCH /api/slide-library/organization/:id - Update an organization-shelf item.
// Permission model:
// - Favorites are per-user and always allowed for authed users.
// - Trashing (soft delete) is restricted to admins or the creator.
async function handleOrganizationUpdate(
  { storageScope, req, res, authedUser },
  id,
) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if ('trashed' in body) {
    const r = await setOrganizationLibraryItemTrashed(storageScope, id, {
      trashed: !!body.trashed,
      actorEmail: email,
      allowTrash: (item) => {
        // Identity is the `users.id` (T10 PR F2): the creator keeps their
        // trash right across a rename, and an item whose creator column is a
        // defined NULL belongs to nobody but an admin.
        if (authedUser?.isAdmin) return true;
        return matchesIdentity(authedUser, { userId: item?.createdBy?.id });
      },
    });
    if (!r.ok) {
      if (r.reason === 'not_found') return notFound(res);
      if (r.reason === 'forbidden') return forbidden(res, 'Not allowed');
      return badRequest(res, r.reason);
    }
    serveJson(res, 200, r.item);
    return true;
  }

  const r = await updateOrganizationLibraryItem(storageScope, id, body, {
    actorEmail: email,
  });
  if (!r.ok)
    return r.reason === 'not_found' ? notFound(res) : badRequest(res, r.reason);
  serveJson(res, 200, r.item);
  return true;
}

// DELETE /api/slide-library/organization/:id - Delete an organization-shelf item.
// Conservative policy: admins can delete, otherwise only the creator.
async function handleOrganizationDelete({ storageScope, res, authedUser }, id) {
  const r = await deleteOrganizationLibraryItem(storageScope, id, {
    actorEmail: actorEmail(authedUser),
    allowDelete: (item) => {
      // Identity is the `users.id` (T10 PR F2); see the trash guard above.
      if (authedUser?.isAdmin) return true;
      return matchesIdentity(authedUser, { userId: item?.createdBy?.id });
    },
  });
  if (!r.ok) {
    if (r.reason === 'not_found') return notFound(res);
    if (r.reason === 'forbidden') return forbidden(res, 'Not allowed');
    return badRequest(res, r.reason);
  }
  serveJson(res, 200, { ok: true });
  return true;
}

// GET /api/slide-library/personal/:id/tags | /api/slide-library/organization/:id/tags
async function handleItemTagsGet({ storageScope, res, authedUser }, id) {
  const tags = await getTagsForSlideLibraryItem(storageScope, id, {
    userEmail: actorEmail(authedUser),
  });
  serveJson(res, 200, tags);
  return true;
}

// PUT /api/slide-library/personal/:id/tags | /api/slide-library/organization/:id/tags
// Body: `{ tags: [...] }` — the one canonical shape (B55). A bare array is a
// 400 from the entry's object guarantee; a missing/non-array `tags` is a 400
// here.
async function handleItemTagsPut({ storageScope, req, res, authedUser }, id) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const tagNames = parsed.body.tags;
  if (!Array.isArray(tagNames)) {
    return badRequest(res, 'Expected { tags: [...] }');
  }
  const tags = await setTagsForSlideLibraryItem(storageScope, id, tagNames, {
    userEmail: actorEmail(authedUser),
  });
  serveJson(res, 200, tags);
  return true;
}

/**
 * Declarative route table for `/api/slide-library*` (A7.19 C8). Order matches
 * the previous if-chain; each path group sent an explicit 405, preserved as
 * trailing catch-all rows (Form B). The two tags groups share one GET and one
 * PUT handler, exactly as their bodies were identical in the chain.
 *
 * The `/usage` catch-all previously called `methodNotAllowed(res)` without an
 * Allow list, which crashed on `allowed.join` — a wrong method there got a 500
 * from the error handler instead of a 405. The row carries the obvious
 * `['GET', 'POST']` now (flagged in the migration PR).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/slide-library/usage',
    handler: handleUsageList,
  },
  {
    method: 'POST',
    pattern: '/api/slide-library/usage',
    handler: handleUsageRecord,
  },
  {
    pattern: '/api/slide-library/usage',
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']),
  },
  {
    method: 'GET',
    pattern: '/api/slide-library/personal',
    handler: handlePersonalList,
  },
  {
    method: 'POST',
    pattern: '/api/slide-library/personal',
    handler: handlePersonalCreate,
  },
  {
    pattern: '/api/slide-library/personal',
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']),
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)$/,
    handler: handlePersonalUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)$/,
    handler: handlePersonalDelete,
  },
  {
    pattern: /^\/api\/slide-library\/personal\/([^/]+)$/,
    handler: ({ res }) => methodNotAllowed(res, ['PATCH', 'DELETE']),
  },
  {
    method: 'GET',
    pattern: '/api/slide-library/organization',
    handler: handleOrganizationList,
  },
  {
    method: 'POST',
    pattern: '/api/slide-library/organization',
    handler: handleOrganizationCreate,
  },
  {
    pattern: '/api/slide-library/organization',
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']),
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)$/,
    handler: handleOrganizationUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)$/,
    handler: handleOrganizationDelete,
  },
  {
    pattern: /^\/api\/slide-library\/organization\/([^/]+)$/,
    handler: ({ res }) => methodNotAllowed(res, ['PATCH', 'DELETE']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)\/tags$/,
    handler: handleItemTagsGet,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)\/tags$/,
    handler: handleItemTagsPut,
  },
  {
    pattern: /^\/api\/slide-library\/personal\/([^/]+)\/tags$/,
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PUT']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)\/tags$/,
    handler: handleItemTagsGet,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)\/tags$/,
    handler: handleItemTagsPut,
  },
  {
    pattern: /^\/api\/slide-library\/organization\/([^/]+)\/tags$/,
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PUT']),
  },
];

/**
 * Handle slide-library API routes. The module-wide guards (path prefix,
 * authentication) run before dispatch, exactly as the original chain did.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleSlideLibrary = withErrorHandler('slide-library', (ctx) => {
  if (!ctx.url.pathname.startsWith('/api/slide-library')) return false;
  if (!ctx.authedUser) return unauthorized(ctx.res);
  return dispatchRoutes(ROUTES, ctx);
});
