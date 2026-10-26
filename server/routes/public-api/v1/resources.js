/**
 * Public API v1 - Resources endpoints.
 * Provides access to themes, slide types, and image library.
 */

import { listOfferedThemes } from '../../../services/theme.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  apiSuccess,
} from './middleware.js';
import { listImagePage } from '../../../services/library-lists.js';
import { listImageLibraryTags } from '../../../storage/image-library.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/themes - List available themes.
 */
async function handleThemes(ctx) {
  if (!requirePermission(ctx, 'read')) return true;

  const { themes } = await listOfferedThemes(ctx.storageScope);
  const allThemes = themes.map((theme) => ({
    id: theme.id,
    slug: theme.slug,
    source: theme.source,
    label: theme.label,
    logoUrl: theme.logoUrl || null,
    colors: theme.colors || null,
    fonts: theme.fonts || null,
    isDefault: theme.isDefault,
  }));

  await apiSuccess(ctx, {
    themes: allThemes,
    count: allThemes.length,
  });
  return true;
}

/**
 * GET /api/v1/slide-types - List available slide types.
 */
async function handleSlideTypes(ctx) {
  if (!requirePermission(ctx, 'read')) return true;

  const definitions = await buildMergedSlideTypes(ctx.storageScope);
  const slideTypes = {};
  for (const [key, def] of Object.entries(definitions)) {
    slideTypes[key] = {
      label: def.label,
      fields: def.fields,
      defaults: def.defaults,
      themeOnly: def.themeOnly === true || undefined,
      defaultsByLang:
        def.defaultsByLang && typeof def.defaultsByLang === 'object'
          ? def.defaultsByLang
          : undefined,
    };
  }

  await apiSuccess(ctx, {
    slideTypes,
    count: Object.keys(slideTypes).length,
  });
  return true;
}

/**
 * GET /api/v1/image-library - List images in the image library, one page at a
 * time on the list-page contract (D358, B822).
 *
 * Query parameters:
 * - search: a case-insensitive substring of the title, description,
 *   photographer, URL, a tag or an alt text
 * - category: only images carrying this tag (case-insensitive); the library
 *   has no category column, tags are what images are grouped by
 * - limit, cursor: the page; send the same `search` and `category` again
 * - offset: refused (`details: { field: 'offset', use: 'cursor' }`)
 *
 * Answers `{ images, nextCursor }`; `nextCursor: null` is the end. The
 * categories are their own list: `GET /api/v1/image-library/categories`.
 */
async function handleImageLibrary(ctx) {
  const { storageScope, apiKey, url } = ctx;

  if (!requirePermission(ctx, 'read')) return true;

  const params = url.searchParams;
  const page = await listImagePage(
    storageScope,
    { readerEmail: apiKey?.ownerEmail || null },
    {
      q: params.get('search') ?? undefined,
      tag: params.get('category') ?? undefined,
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
      ...(params.has('offset') ? { offset: params.get('offset') } : {}),
    },
    { collection: 'images' },
  );

  await apiSuccess(ctx, page);
  return true;
}

/**
 * GET /api/v1/image-library/categories - Every tag in the image library, the
 * values `category` filters on, alphabetically. Its own query (B822), so a
 * page of images never pays for it.
 */
async function handleImageCategories(ctx) {
  if (!requirePermission(ctx, 'read')) return true;

  const tags = await listImageLibraryTags(ctx.storageScope);
  await apiSuccess(ctx, {
    categories: tags.map((tag) => tag.name).sort((a, b) => a.localeCompare(b)),
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/** Read-only catalogue routes; any other method answers 405. */
export const ROUTES = [
  {
    method: 'GET',
    id: 'listThemes',
    pattern: '/api/v1/themes',
    handler: handleThemes,
  },
  {
    pattern: '/api/v1/themes',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    id: 'listSlideTypes',
    pattern: '/api/v1/slide-types',
    handler: handleSlideTypes,
  },
  {
    pattern: '/api/v1/slide-types',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    id: 'listImageLibraryItems',
    pattern: '/api/v1/image-library',
    handler: handleImageLibrary,
  },
  {
    pattern: '/api/v1/image-library',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    id: 'listImageLibraryCategories',
    pattern: '/api/v1/image-library/categories',
    handler: handleImageCategories,
  },
  {
    pattern: '/api/v1/image-library/categories',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
];

/**
 * Main handler for /api/v1/themes, /api/v1/slide-types, /api/v1/image-library
 * (and its categories) routes.
 */
export const handleResources = withV1ErrorHandler(
  'public-api-v1:resources',
  (ctx) => dispatchV1Routes(ROUTES, ctx),
);
