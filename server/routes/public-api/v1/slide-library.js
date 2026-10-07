/**
 * Public API v1 - Slide Library endpoints.
 * Provides read-only access to the organization slide library and ability to add library slides to presentations.
 */

import {
  listOrganizationLibrary,
  getOrganizationLibraryItem,
  getTagsForSlideLibraryItems,
  getTagsForSlideLibraryItem,
} from '../../../storage/slide-library.js';
import { addSlide } from '../../../services/slides.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  readApiV1Body,
  apiSuccess,
  apiCreated,
  apiError,
} from './middleware.js';
import { parsePaginationParams } from '../../../utils/request-validators.js';
import { getNonNegativeNumber } from '../../../utils/request-validators.js';

/**
 * Sanitize a library item for API response.
 * @param {object} item
 * @param {Array<{id: string, name: string}>} [tags]
 */
function sanitizeLibraryItem(item, tags = []) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name || '',
    slideType: item.slideType || '',
    // The name a theme has on every v1 surface (B446, B449). Storage keeps
    // the column's own name; the rename happens here, once.
    theme: item.themeId || null,
    content: item.content || {},
    tags,
    createdAt: item.createdAt || null,
    // The stable id only. This used to be `createdBy`, the creator's e-mail,
    // handed to any API key with library read access — a contact detail the
    // caller has no claim on (D22). The id names the same person and discloses
    // nothing about them, exactly as `ownerId` does on a deck.
    createdById: item.createdBy?.id || null,
  };
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/slide-library - List organization-library items.
 */
async function handleList(ctx) {
  const { storageScope, apiKey, url } = ctx;

  if (!requirePermission(ctx, 'read')) return true;

  // `themeId` was this filter's name while decks said `theme`; the retired
  // spelling is refused with the name to use, never read beside it (B449).
  if (url.searchParams.has('themeId')) {
    await apiError(ctx, 400, 'Unknown parameter "themeId": use "theme"', {
      details: { field: 'themeId', use: 'theme' },
    });
    return true;
  }
  const theme = url.searchParams.get('theme') || '';
  const { limit, offset } = parsePaginationParams(url.searchParams);

  const { items: allItems } = await listOrganizationLibrary(storageScope, {
    themeId: theme,
    userEmail: apiKey.ownerEmail,
  });

  // Filter out trashed items
  const items = (allItems || []).filter((it) => !it.trashedAt);

  // Pagination
  const total = items.length;
  const paginated = items.slice(offset, offset + limit);

  // Fetch tags for items
  const ids = paginated.map((it) => it.id);
  const tagsMap =
    ids.length > 0
      ? await getTagsForSlideLibraryItems(storageScope, ids, {
          userEmail: apiKey.ownerEmail,
        })
      : new Map();

  const sanitizedItems = paginated.map((it) =>
    sanitizeLibraryItem(it, tagsMap.get(it.id) || []),
  );

  await apiSuccess(ctx, {
    items: sanitizedItems,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
  return true;
}

/**
 * GET /api/v1/slide-library/:itemId - Get a single library item.
 */
async function handleGet(ctx, itemId) {
  const { storageScope, apiKey } = ctx;

  if (!requirePermission(ctx, 'read')) return true;

  const item = await getOrganizationLibraryItem(storageScope, itemId, {
    userEmail: apiKey.ownerEmail,
  });

  if (!item || item.trashedAt) {
    await apiError(ctx, 404, 'Library item not found');
    return true;
  }

  const tagged = await getTagsForSlideLibraryItem(
    storageScope,
    { id: itemId, shelf: 'organization' },
    { userEmail: apiKey.ownerEmail },
  );
  // The item left the shelf between the two reads: it is gone, not tagless.
  if (!tagged.ok) {
    await apiError(ctx, 404, 'Library item not found');
    return true;
  }

  await apiSuccess(ctx, {
    item: sanitizeLibraryItem(item, tagged.tags),
  });
  return true;
}

/**
 * POST /api/v1/presentations/:id/slides/from-library - Add a slide from library.
 */
async function handleAddFromLibrary(ctx, presentationId) {
  const { storageScope, apiKey } = ctx;

  if (!requirePermission(ctx, 'write')) return true;

  const { ok: bodyOk, body } = await readApiV1Body(ctx, ctx.req);
  if (!bodyOk) return true;

  const libraryItemId = body?.libraryItemId;
  if (!libraryItemId) {
    await apiError(ctx, 400, 'libraryItemId is required');
    return true;
  }

  // Load library item
  const libraryItem = await getOrganizationLibraryItem(
    storageScope,
    libraryItemId,
    {
      userEmail: apiKey.ownerEmail,
    },
  );

  if (!libraryItem || libraryItem.trashedAt) {
    await apiError(ctx, 404, 'Library item not found');
    return true;
  }

  // The insert is the slide service's add (B572, B575): the write right, the
  // one factory (deck theme and language, the item's content as the patch,
  // the organization's own custom types), strict validation, and a write that
  // keeps the deck's other language versions. A refusal is thrown and
  // `withV1ErrorHandler` renders it.
  const {
    slide: newSlideObj,
    index: insertIndex,
    presentation: updated,
  } = await addSlide(
    storageScope,
    { actor: ctx.authedUser },
    {
      presentationId,
      type: libraryItem.slideType,
      content: libraryItem.content,
      atIndex: getNonNegativeNumber(body, 'atIndex'),
      afterSlideId: body.afterSlideId,
    },
  );

  await apiCreated(ctx, {
    slide: newSlideObj,
    index: insertIndex,
    copiedFrom: {
      libraryItemId: libraryItem.id,
      libraryItemName: libraryItem.name || '',
    },
    presentation: {
      id: updated.id,
      slideCount: updated.slides?.length || 0,
      revision: updated.revision || 0,
    },
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/** Slide-library routes; a known path with another method answers 405. */
export const ROUTES = [
  {
    method: 'POST',
    id: 'insertSlidesFromLibrary',
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides\/from-library$/,
    captures: ['uuid'],
    handler: handleAddFromLibrary,
  },
  {
    pattern: /^\/api\/v1\/presentations\/([^/]+)\/slides\/from-library$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['POST']),
  },
  {
    method: 'GET',
    id: 'getSlideLibraryItem',
    pattern: /^\/api\/v1\/slide-library\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleGet,
  },
  {
    pattern: /^\/api\/v1\/slide-library\/([^/]+)$/,
    captures: ['uuid'],
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    id: 'listSlideLibraryItems',
    pattern: '/api/v1/slide-library',
    handler: handleList,
  },
  {
    pattern: '/api/v1/slide-library',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
];

/**
 * Main handler for /api/v1/slide-library routes.
 */
export const handleSlideLibrary = withV1ErrorHandler(
  'public-api-v1:slide-library',
  (ctx) => dispatchV1Routes(ROUTES, ctx),
);
