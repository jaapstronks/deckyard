/**
 * Public API v1 - Resources endpoints.
 * Provides access to themes, slide types, and image library.
 */

import { sandboxEnabled } from '../../../config/sandbox.js';
import { listThemes } from '../../../storage/themes.js';
import { getDefaultThemeId } from '../../../storage/settings.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  apiSuccess,
} from './middleware.js';
import { parsePaginationParams } from '../../../utils/request-validators.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/themes - List available themes.
 */
async function handleThemes(ctx) {
  if (!requirePermission(ctx, 'read')) return true;

  // A key acts in the organization it belongs to; the storage scope built by
  // the v1 auth middleware carries exactly that.
  const routeCtx = ctx.storageScope;

  const [records, defaultThemeId] = await Promise.all([
    listThemes(routeCtx),
    getDefaultThemeId(routeCtx),
  ]);
  const visible = sandboxEnabled()
    ? records.filter((theme) => theme.source === 'seed')
    : records;
  const allThemes = visible.map((t) => ({
    id: t.id,
    slug: t.slug,
    source: t.source,
    label: t.label,
    logoUrl: t.logoUrl || null,
    colors: t.colors || null,
    fonts: t.fonts || null,
    isDefault: t.id === defaultThemeId,
  }));
  allThemes.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'organization' ? -1 : 1;
    return String(a.label).localeCompare(String(b.label));
  });

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

  const slideTypes = {};
  for (const [key, def] of Object.entries(SLIDE_TYPES)) {
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
 * GET /api/v1/image-library - List images in the image library.
 */
async function handleImageLibrary(ctx) {
  const { storageScope, url } = ctx;

  if (!requirePermission(ctx, 'read')) return true;

  // Dynamic import to avoid circular dependencies
  const { listImageLibrary } =
    await import('../../../storage/image-library.js');

  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const category = (url.searchParams.get('category') || '')
    .trim()
    .toLowerCase();
  const { limit, offset } = parsePaginationParams(url.searchParams);

  const all = await listImageLibrary(storageScope);
  const items = Array.isArray(all) ? all : [];

  // The library has no category column; tags are what images are grouped by, so
  // that is what `category` filters on and what the categories list reports.
  const categories = Array.from(
    new Set(
      items
        .flatMap((it) => (Array.isArray(it?.tags) ? it.tags : []))
        .filter(Boolean),
    ),
  ).sort();

  const matches = items.filter((it) => {
    const tags = (Array.isArray(it?.tags) ? it.tags : []).map((t) =>
      String(t).toLowerCase(),
    );
    if (category && !tags.includes(category)) return false;
    if (!search) return true;
    const haystack = [it?.title, it?.description, it?.photographer, ...tags]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  });

  const total = matches.length;

  await apiSuccess(ctx, {
    images: matches.slice(offset, offset + limit),
    categories,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/** Read-only catalogue routes; any other method answers 405. */
export const ROUTES = [
  { method: 'GET', pattern: '/api/v1/themes', handler: handleThemes },
  {
    pattern: '/api/v1/themes',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  { method: 'GET', pattern: '/api/v1/slide-types', handler: handleSlideTypes },
  {
    pattern: '/api/v1/slide-types',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    pattern: '/api/v1/image-library',
    handler: handleImageLibrary,
  },
  {
    pattern: '/api/v1/image-library',
    handler: ({ res }) => v1MethodNotAllowed(res, ['GET']),
  },
];

/**
 * Main handler for /api/v1/themes, /api/v1/slide-types, /api/v1/image-library routes.
 */
export const handleResources = withV1ErrorHandler(
  'public-api-v1:resources',
  (ctx) => dispatchV1Routes(ROUTES, ctx),
);
