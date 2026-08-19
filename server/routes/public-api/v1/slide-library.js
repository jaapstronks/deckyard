/**
 * Public API v1 - Slide Library endpoints.
 * Provides read-only access to the organization slide library and ability to add library slides to presentations.
 */

import {
  listOrganizationLibrary,
  getOrganizationLibraryItem,
  getTagsForSlideLibraryItems,
  getTagsForSlideLibraryItem,
} from '../../../storage/slide-library/index.js';
import { updatePresentation } from '../../../storage/presentations/index.js';
import { newSlide } from '../../../../shared/slide-types.js';
import {
  requirePermission,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  getPresentationWithAccess,
  readApiV1Body,
  parsePaginationParams,
  apiSuccess,
  apiCreated,
  apiError,
} from './middleware.js';
import { getNonNegativeNumber } from '../../../utils/request-validators.js';

/**
 * Sanitize a library item for API response.
 */
function sanitizeLibraryItem(item, tags = []) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name || '',
    slideType: item.slideType || '',
    themeId: item.themeId || null,
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

  const themeId = url.searchParams.get('themeId') || '';
  const { limit, offset } = parsePaginationParams(url);

  const { items: allItems } = await listOrganizationLibrary(storageScope, {
    themeId,
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

  const tags = await getTagsForSlideLibraryItem(storageScope, itemId, {
    userEmail: apiKey.ownerEmail,
  });

  await apiSuccess(ctx, {
    item: sanitizeLibraryItem(item, tags),
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

  // Load presentation
  const { ok, pres } = await getPresentationWithAccess(ctx, presentationId, {
    access: 'write',
  });
  if (!ok) return true;

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

  // Create new slide from library item content
  let newSlideObj;
  try {
    newSlideObj = newSlide({ type: libraryItem.slideType });
    // Override with library content
    newSlideObj.content = { ...libraryItem.content };
  } catch (e) {
    await apiError(ctx, 400, `Invalid slide type: ${libraryItem.slideType}`);
    return true;
  }

  // Determine insertion position
  const slides = Array.isArray(pres.slides) ? [...pres.slides] : [];
  let insertIndex = slides.length; // Default: append at end

  const atIndex = getNonNegativeNumber(body, 'atIndex');
  if (atIndex !== null) {
    insertIndex = Math.min(atIndex, slides.length);
  } else if (body.afterSlideId) {
    const afterIdx = slides.findIndex((s) => s.id === body.afterSlideId);
    if (afterIdx >= 0) {
      insertIndex = afterIdx + 1;
    }
  }

  // Insert the new slide
  slides.splice(insertIndex, 0, newSlideObj);

  // Update presentation (throws answered in the v1 envelope by the wrap).
  const updated = await updatePresentation(
    storageScope,
    presentationId,
    { slides },
    {
      actorEmail: apiKey.ownerEmail,
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

/**
 * Main handler for /api/v1/slide-library routes.
 */
export const handleSlideLibrary = withV1ErrorHandler(
  'public-api-v1:slide-library',
  async (ctx) => {
    const { req, res, url } = ctx;

    // POST /api/v1/presentations/:id/slides/from-library
    const fromLibraryMatch = url.pathname.match(
      /^\/api\/v1\/presentations\/([^/]+)\/slides\/from-library$/,
    );
    if (fromLibraryMatch) {
      if (req.method !== 'POST') return v1MethodNotAllowed(res, ['POST']);
      return handleAddFromLibrary(ctx, fromLibraryMatch[1]);
    }

    // GET /api/v1/slide-library/:itemId
    const itemMatch = url.pathname.match(/^\/api\/v1\/slide-library\/([^/]+)$/);
    if (itemMatch) {
      if (req.method !== 'GET') return v1MethodNotAllowed(res, ['GET']);
      return handleGet(ctx, itemMatch[1]);
    }

    // GET /api/v1/slide-library
    if (url.pathname === '/api/v1/slide-library') {
      if (req.method !== 'GET') return v1MethodNotAllowed(res, ['GET']);
      return handleList(ctx);
    }

    return false;
  },
);
