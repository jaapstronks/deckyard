import {
  badRequest,
  jsonError,
  methodNotAllowed,
  notFound,
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
  getLibraryShelfItem,
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
import { getRequestOrigin } from '../../utils/request-url.js';
import { findTheme, loadThemeAssets } from '../../utils/themes.js';
import { generateAndSaveOgPreview } from '../../render/preview-image.js';
import { isMediaProviderInitialized } from '../../media/index.js';
import { dispatchRoutes } from '../../utils/router.js';
import { createLogger } from '../../utils/logger.js';
import { matchesIdentity } from '../../../shared/identity-match.js';
import { fireAndForget } from '../../utils/fire-and-forget.js';
import { notifyLibraryItemRevision } from '../../services/library-revision-notifications.js';
import { parseIfMatchRevision } from './presentations/helpers.js';
import { sharingEnabled } from '../../config/sandbox.js';
import { buildMergedSlideTypes } from '../../utils/custom-slide-type-runtime.js';
import { isLibrarySlideType } from '../../../shared/slide-types/policy.js';
import { assertSharingEnabled } from '../../sandbox/sharing.js';
import { normalizeEmail } from '../../../shared/email.js';
import {
  libraryListInput,
  listLibraryFacets,
  listLibraryPage,
} from '../../services/library-lists.js';
const log = createLogger('slide-library');

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
  // The organization shelf is read-only where sharing is off (D181), for everyone.
  if (!sharingEnabled()) return false;
  if (authedUser?.isAdmin) return true;
  return matchesIdentity(authedUser, { userId: item?.createdBy?.id });
}

/**
 * Refuse a create for a type that declares `library: false` (B401): the same
 * predicate the editor's Save-to-library action reads, so the API cannot put
 * on a shelf what the UI withholds. Resolved against the organization's
 * registry, like every write surface. Answers itself and returns true on a
 * refusal (400 `invalid`, field `slideType`).
 *
 * @param {object} storageScope
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} slideType
 * @returns {Promise<boolean>}
 */
async function refuseNonLibraryType(storageScope, res, slideType) {
  const type = typeof slideType === 'string' ? slideType.trim() : '';
  if (!type) return false;
  const slideTypes = await buildMergedSlideTypes(storageScope);
  if (isLibrarySlideType(slideTypes[type])) return false;
  mutationError(res, {
    reason: 'invalid',
    field: 'slideType',
    message: `"${type}" has no content of its own and cannot be saved to the slide library`,
  });
  return true;
}

/**
 * Refuse a create whose `themeId` is not a theme this organization has (B718):
 * the one spelling a stored reference has (D237), `default` or a visible record
 * UUID, checked the way a deck's theme switch checks it. A slug stored here
 * would fail every render of the item, and the theme is fixed at create, so
 * this is the only door. An absent theme stays absent. Answers itself and
 * returns true on a refusal (400 `invalid`, field `themeId`).
 *
 * @param {string} repoRoot
 * @param {object} storageScope
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} themeId
 * @returns {Promise<boolean>}
 */
async function refuseUnknownTheme(repoRoot, storageScope, res, themeId) {
  if (themeId === undefined || themeId === null || themeId === '') return false;
  if (await findTheme(repoRoot, themeId, storageScope)) return false;
  mutationError(res, {
    reason: 'invalid',
    field: 'themeId',
    message: `${JSON.stringify(themeId)} is not a theme of this organization: use "default" or a theme record UUID`,
  });
  return true;
}

/**
 * The save-contract options a PATCH hands to storage (D170): the `If-Match`
 * revision. Answers itself and returns null for a patch
 * outside the closed key set (400 `invalid` with the field) and for a
 * name/description/content edit without `If-Match` (428).
 */
function patchOptions(req, res, body) {
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
  return { expectedRevision };
}

function actorEmail(authedUser) {
  return normalizeEmail(authedUser?.email);
}

/**
 * After a PATCH that raised the item's revision, tell the owners of decks
 * with an older linked copy (B904). A favorite or a trash toggle leaves the
 * revision alone and notifies nobody.
 */
function announceRevision(storageScope, authedUser, opts, item) {
  if (
    !Number.isInteger(opts?.expectedRevision) ||
    item?.revision !== opts.expectedRevision + 1
  )
    return;
  fireAndForget(
    notifyLibraryItemRevision({
      scope: storageScope,
      item,
      actor: { email: authedUser?.email, name: authedUser?.name },
    }),
    'library revision notifications',
  );
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

/**
 * Stamp a page of library items with what the reader may do and the tags
 * they carry: `canEdit` (D170) and `tags`, one batched read.
 *
 * @param {object} storageScope
 * @param {object[]} items
 * @param {object} opts
 * @param {(item: object) => boolean} opts.canEdit
 * @param {string} opts.email - The reader.
 * @returns {Promise<object[]>}
 */
async function stampLibraryItems(storageScope, items, { canEdit, email }) {
  const tagsMap = items.length
    ? await getTagsForSlideLibraryItems(
        storageScope,
        items.map((it) => it.id),
        { userEmail: email },
      )
    : new Map();
  return items.map((item) => ({
    ...item,
    canEdit: canEdit(item),
    tags: tagsMap.get(item.id) || [],
  }));
}

/**
 * The reader's verdict on an item of a shelf: the personal shelf holds only
 * the caller's own items; the organization shelf follows the one guard.
 * @param {'personal'|'organization'} shelf
 * @param {object|null} authedUser
 * @returns {(item: object) => boolean}
 */
function canEditOn(shelf, authedUser) {
  return shelf === 'personal'
    ? () => true
    : (item) => canEditOrganizationItem(authedUser, item);
}

// GET /api/slide-library/{personal|organization} - One page of a shelf, or of
// its trash (`view=trash`), on the list-page contract (D358, B822):
// `{ items, nextCursor }`. Filters (`theme`, `type`, `tag`, `lang`, `q`) are
// applied in the query; see server/services/library-lists.js.
function shelfList(shelf) {
  return async function handleShelfList({
    storageScope,
    res,
    url,
    authedUser,
  }) {
    const email = actorEmail(authedUser);
    const { items, nextCursor } = await listLibraryPage(
      storageScope,
      { shelf, readerEmail: email },
      libraryListInput(url.searchParams),
    );
    serveJson(res, 200, {
      items: await stampLibraryItems(storageScope, items, {
        canEdit: canEditOn(shelf, authedUser),
        email,
      }),
      nextCursor,
    });
    return true;
  };
}

// GET /api/slide-library/{personal|organization}/facets - Counts per slide
// type and per tag over the shelf (the picker's filter chips), own query.
function shelfFacets(shelf) {
  return async function handleShelfFacets({
    storageScope,
    res,
    url,
    authedUser,
  }) {
    const facets = await listLibraryFacets(
      storageScope,
      { shelf, readerEmail: actorEmail(authedUser) },
      libraryListInput(url.searchParams),
    );
    serveJson(res, 200, facets);
    return true;
  };
}

// GET /api/slide-library/{personal|organization}/:id - One item as its reader
// may see it (the permalink). Someone else's personal item is a 404.
function shelfItem(shelf) {
  return async function handleShelfItem({ storageScope, res, authedUser }, id) {
    const email = actorEmail(authedUser);
    const item = await getLibraryShelfItem(
      storageScope,
      { id, shelf },
      { userEmail: email },
    );
    if (!item) return notFound(res);
    const [stamped] = await stampLibraryItems(storageScope, [item], {
      canEdit: canEditOn(shelf, authedUser),
      email,
    });
    serveJson(res, 200, stamped);
    return true;
  };
}

// POST /api/slide-library/personal - Save a slide to the personal library
async function handlePersonalCreate({
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
  if (await refuseNonLibraryType(storageScope, res, body?.slideType)) {
    return true;
  }
  if (await refuseUnknownTheme(repoRoot, storageScope, res, body?.themeId)) {
    return true;
  }
  const r = await createPersonalLibraryItem(storageScope, email, body, {
    actorEmail: email,
  });
  if (!r.ok) return mutationError(res, r);
  serveJson(res, 201, { ...r.item, canEdit: true });
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
  const opts = patchOptions(req, res, body);
  if (!opts) return true;
  const r = await updatePersonalLibraryItem(storageScope, email, id, body, {
    actorEmail: email,
    ...opts,
  });
  if (!r.ok) return mutationError(res, r);
  announceRevision(storageScope, authedUser, opts, r.item);
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

// POST /api/slide-library/organization - Save a slide to the organization library
async function handleOrganizationCreate({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
}) {
  assertSharingEnabled();
  const email = actorEmail(authedUser);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  if (await refuseNonLibraryType(storageScope, res, body?.slideType)) {
    return true;
  }
  if (await refuseUnknownTheme(repoRoot, storageScope, res, body?.themeId)) {
    return true;
  }
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
      const theme = await loadThemeAssets(
        repoRoot,
        r.item.themeId,
        storageScope,
      );
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
    maybeFireWebhook(repoRoot, getRequestOrigin(req), {
      event: 'slide.added_to_organization_library',
      slideItem: { ...r.item, previewUrl },
      authedUser,
    }),
    'webhook delivery',
  );

  serveJson(res, 201, {
    ...r.item,
    previewUrl,
    canEdit: canEditOrganizationItem(authedUser, r.item),
  });
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
  const opts = patchOptions(req, res, body);
  if (!opts) return true;
  const r = await updateOrganizationLibraryItem(storageScope, id, body, {
    actorEmail: email,
    ...opts,
    allowEdit: (item) => canEditOrganizationItem(authedUser, item),
  });
  if (!r.ok) return mutationError(res, r);
  announceRevision(storageScope, authedUser, opts, r.item);
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
    pattern: '/api/slide-library/personal/facets',
    handler: shelfFacets('personal'),
  },
  {
    pattern: '/api/slide-library/personal/facets',
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    pattern: '/api/slide-library/personal',
    handler: shelfList('personal'),
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
    method: 'GET',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)$/,
    captures: ['uuid'],
    handler: shelfItem('personal'),
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)$/,
    captures: ['uuid'],
    handler: handlePersonalUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)$/,
    captures: ['uuid'],
    handler: handlePersonalDelete,
  },
  {
    pattern: /^\/api\/slide-library\/personal\/([^/]+)$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']),
  },
  {
    method: 'GET',
    pattern: '/api/slide-library/organization/facets',
    handler: shelfFacets('organization'),
  },
  {
    pattern: '/api/slide-library/organization/facets',
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    pattern: '/api/slide-library/organization',
    handler: shelfList('organization'),
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
    method: 'GET',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)$/,
    captures: ['uuid'],
    handler: shelfItem('organization'),
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleOrganizationUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleOrganizationDelete,
  },
  {
    pattern: /^\/api\/slide-library\/organization\/([^/]+)$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)\/tags$/,
    captures: ['uuid'],
    handler: itemTagsGet('personal'),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/slide-library\/personal\/([^/]+)\/tags$/,
    captures: ['uuid'],
    handler: itemTagsPut('personal'),
  },
  {
    pattern: /^\/api\/slide-library\/personal\/([^/]+)\/tags$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET', 'PUT']),
  },
  {
    method: 'GET',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)\/tags$/,
    captures: ['uuid'],
    handler: itemTagsGet('organization'),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/slide-library\/organization\/([^/]+)\/tags$/,
    captures: ['uuid'],
    handler: itemTagsPut('organization'),
  },
  {
    pattern: /^\/api\/slide-library\/organization\/([^/]+)\/tags$/,
    captures: ['uuid'],
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
