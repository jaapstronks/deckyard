import {
  badRequest,
  forbidden,
  jsonError,
  methodNotAllowed,
  requireJsonBody,
  serveJson,
  storageError,
  unauthorized,
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
  libraryPatchViolation,
  getTagsForSlideLibraryItem,
  getTagsForSlideLibraryItems,
  setTagsForSlideLibraryItem,
} from '../../storage/slide-library.js';
import {
  listSlideLibraryUsage,
  recordSlideLibraryUsage,
} from '../../storage/slide-library-usage.js';
import { maybeFireWebhook } from '../../utils/webhooks.js';
import { loadThemeAssets } from '../../utils/themes.js';
import { generateAndSaveOgPreview } from '../../render/preview-image.js';
import { isMediaProviderInitialized } from '../../media/index.js';
import { dispatchRoutes } from '../../utils/router.js';
import { createLogger } from '../../utils/logger.js';
import { matchesIdentity } from '../../../shared/identity-match.js';
import { fireAndForget } from '../../utils/fire-and-forget.js';
import {
  canEditCustomHtml,
  customHtmlEditViolation,
} from '../../utils/route-middleware.js';
import { parseIfMatchRevision } from './presentations/helpers.js';
const log = createLogger('slide-library');

function cleanThemeId(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.slice(0, 80);
}

/**
 * Answer a failed slide-library mutation in the canonical envelope. The reason
 * is the machine code and its `REASONS` entry decides the status, which is what
 * retired the not_found/forbidden/else ladders this file used to repeat at six
 * call sites — each of them flattening every other reason to a 400.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{reason: string, field?: string}} result
 * @returns {true}
 */
function mutationError(res, result) {
  return storageError(res, result, result.message);
}

/**
 * The one predicate for "may this user change this shared item" (D170): its
 * name, description or content, trashing it, and deleting it. An admin, or the
 * creator by `users.id` (T10 PR F2) — the creator keeps the right across a
 * rename, and an item whose creator column is a defined NULL belongs to nobody
 * but an admin. The lists expose it as `canEdit`, so the client derives nothing.
 *
 * @param {object|null} authedUser
 * @param {object} item - A mapped library item
 * @returns {boolean}
 */
function canEditOrganizationItem(authedUser, item) {
  if (authedUser?.isAdmin) return true;
  return matchesIdentity(authedUser, { userId: item?.createdBy?.id });
}

/**
 * The raw-HTML/CSS capability gate on a library item, the same one every deck
 * write path enforces: a user without `canEditCustomHtml` may not create or
 * change the markup of a custom-html-slide. Returns a refusal message or null.
 *
 * @param {object|null} authedUser
 * @param {{id?: string, slideType?: string, content?: object}|null} prev - The stored item, or null on create
 * @param {string} slideType
 * @param {object[]} nextContents - Every content object being written
 * @returns {string|null}
 */
function customHtmlViolation(authedUser, prev, slideType, nextContents) {
  const id = prev?.id || 'new';
  const prevSlides = prev
    ? [{ id, type: prev.slideType, content: prev.content }]
    : [];
  for (const content of nextContents) {
    const violation = customHtmlEditViolation(
      prevSlides,
      [{ id, type: slideType, content }],
      canEditCustomHtml(authedUser),
    );
    if (violation) return violation;
  }
  return null;
}

/** Every content object a create body carries: the base and each language version. */
function createContents(body) {
  const versions = body?.i18n?.versions;
  return [
    body?.content,
    ...(versions && typeof versions === 'object'
      ? Object.values(versions).map((v) => v?.content)
      : []),
  ].filter(Boolean);
}

/**
 * The save-contract options a PATCH hands to storage (D170): the `If-Match`
 * revision and the content gate. Answers itself and returns null for a patch
 * outside the closed key set (400 `invalid` with the field) and for a
 * name/description/content edit without `If-Match` (428).
 */
function patchOptions(req, res, body, authedUser) {
  const invalid = libraryPatchViolation(body);
  if (invalid) {
    mutationError(res, invalid);
    return null;
  }
  const edits = ['name', 'description', 'content'].some((k) => k in body);
  const expectedRevision = parseIfMatchRevision(req);
  if (edits && expectedRevision == null) {
    jsonError(res, 428, 'missing_if_match', 'Missing If-Match revision');
    return null;
  }
  return {
    expectedRevision,
    contentGuard: (item, next) =>
      customHtmlViolation(authedUser, item, item.slideType, [next]),
  };
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
  // The personal list holds only the caller's own items.
  for (const item of out.items) item.canEdit = true;
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
  const violation = customHtmlViolation(
    authedUser,
    null,
    body?.slideType,
    createContents(body),
  );
  if (violation) return forbidden(res, violation);
  const r = await createPersonalLibraryItem(storageScope, email, body, {
    actorEmail: email,
  });
  if (!r.ok) return mutationError(res, r);
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
  const opts = patchOptions(req, res, body, authedUser);
  if (!opts) return true;
  const r = await updatePersonalLibraryItem(storageScope, email, id, body, {
    actorEmail: email,
    ...opts,
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 200, { ...r.item, canEdit: true });
  return true;
}

// DELETE /api/slide-library/personal/:id - Delete a personal item
async function handlePersonalDelete({ storageScope, res, authedUser }, id) {
  const r = await deletePersonalLibraryItem(
    storageScope,
    actorEmail(authedUser),
    id,
  );
  // Every failure used to flatten to 404 here, `unavailable` included; the
  // reason now decides, so a pool that is down answers 503.
  if (!r.ok) return mutationError(res, r);
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
  for (const item of out.items) {
    item.canEdit = canEditOrganizationItem(authedUser, item);
  }
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
  const violation = customHtmlViolation(
    authedUser,
    null,
    body?.slideType,
    createContents(body),
  );
  if (violation) return forbidden(res, violation);
  const r = await createOrganizationLibraryItem(storageScope, body, {
    actorEmail: email,
  });
  if (!r.ok) return mutationError(res, r);

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
  fireAndForget(
    maybeFireWebhook(repoRoot, req, {
      event: 'slide.added_to_organization_library',
      slideItem: { ...r.item, previewUrl },
      authedUser,
    }),
    'webhook delivery',
  );

  serveJson(res, 201, { ...r.item, previewUrl });
  return true;
}

// PATCH /api/slide-library/organization/:id - Update an organization-shelf item.
// Permission model (D170): changing the name, description or content, and
// trashing, follow one guard - admin or creator. `favorite` is per user and
// open to every member: it marks the caller's own star, not the shared item.
async function handleOrganizationUpdate(
  { storageScope, req, res, authedUser },
  id,
) {
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const opts = patchOptions(req, res, body, authedUser);
  if (!opts) return true;
  const r = await updateOrganizationLibraryItem(storageScope, id, body, {
    actorEmail: email,
    ...opts,
    allowEdit: (item) => canEditOrganizationItem(authedUser, item),
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 200, {
    ...r.item,
    canEdit: canEditOrganizationItem(authedUser, r.item),
  });
  return true;
}

// DELETE /api/slide-library/organization/:id - Delete an organization-shelf item.
// Conservative policy: admins can delete, otherwise only the creator.
async function handleOrganizationDelete({ storageScope, res, authedUser }, id) {
  const r = await deleteOrganizationLibraryItem(storageScope, id, {
    actorEmail: actorEmail(authedUser),
    allowDelete: (item) => canEditOrganizationItem(authedUser, item),
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 200, { ok: true });
  return true;
}

// GET /api/slide-library/{personal|organization}/:id/tags - Someone else's
// personal item, or an item on the other shelf, is a 404. Organization-shelf
// tags are readable by every member. The storage layer selects the item through
// the same WHERE as every mutation, so the route adds no rule of its own (B340).
function itemTagsGet(shelf) {
  return async function handleItemTagsGet(
    { storageScope, res, authedUser },
    id,
  ) {
    const r = await getTagsForSlideLibraryItem(
      storageScope,
      { id, shelf },
      { userEmail: actorEmail(authedUser) },
    );
    if (!r.ok) return mutationError(res, r);
    serveJson(res, 200, r.tags);
    return true;
  };
}

// PUT /api/slide-library/{personal|organization}/:id/tags
// Body: `{ tags: [...] }` — the one canonical shape (B55). A bare array is a
// 400 from the entry's object guarantee; a missing/non-array `tags` is a 400
// here. On the organization shelf, writing tags is changing a shared item:
// admin or creator (D170), otherwise a 403. Tags take no If-Match; they do
// not raise the revision.
function itemTagsPut(shelf) {
  return async function handleItemTagsPut(
    { storageScope, req, res, authedUser },
    id,
  ) {
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const tagNames = parsed.body.tags;
    if (!Array.isArray(tagNames)) {
      return badRequest(res, 'Expected { tags: [...] }');
    }
    const r = await setTagsForSlideLibraryItem(
      storageScope,
      { id, shelf },
      tagNames,
      {
        actorEmail: actorEmail(authedUser),
        allowEdit: (item) => canEditOrganizationItem(authedUser, item),
      },
    );
    if (!r.ok) return mutationError(res, r);
    serveJson(res, 200, r.tags);
    return true;
  };
}

/**
 * Declarative route table for `/api/slide-library*` (A7.19 C8). Order matches
 * the previous if-chain; each path group sent an explicit 405, preserved as
 * trailing catch-all rows (Form B). The two tags groups share one GET and one
 * PUT handler factory; the row names the shelf, which selects the item (B340).
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
    handler: itemTagsGet('personal'),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)\/tags$/,
    handler: itemTagsPut('personal'),
  },
  {
    pattern: /^\/api\/slide-library\/personal\/([^/]+)\/tags$/,
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PUT']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)\/tags$/,
    handler: itemTagsGet('organization'),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)\/tags$/,
    handler: itemTagsPut('organization'),
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
