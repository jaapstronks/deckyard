/**
 * Public API v1 - Resources endpoints.
 * Provides access to themes, slide types, and image library.
 */

import { listThemeIds, loadThemeAssets } from '../../../utils/themes.js';
import { sandboxEnabled } from '../../../config/sandbox.js';
import { listThemes } from '../../../storage/themes.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types.js';
import { newSlide } from '../../../../shared/slide-types/presentation.js';
import { resolveTypeDefaults } from '../../../../shared/slide-types/type-defaults.js';
import {
  requirePermission,
  dispatchV1Routes,
  v1MethodNotAllowed,
  withV1ErrorHandler,
  apiSuccess,
  apiError,
} from './middleware.js';
import { parsePaginationParams } from '../../../utils/request-validators.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/themes - List available themes.
 */
async function handleThemes(ctx) {
  const { repoRoot } = ctx;

  if (!requirePermission(ctx, 'read')) return true;

  // A key acts in the organization it belongs to; the storage scope built by
  // the v1 auth middleware carries exactly that.
  const routeCtx = ctx.storageScope;

  // Load system themes from filesystem
  const systemThemeIds = await listThemeIds(repoRoot);
  const filteredSystemIds = sandboxEnabled()
    ? systemThemeIds.filter((id) => String(id).startsWith('sandbox-'))
    : systemThemeIds;

  const systemThemes = [];
  for (const id of filteredSystemIds) {
    try {
      const t = await loadThemeAssets(repoRoot, id);
      systemThemes.push({
        id: String(t?.id || id),
        label: String(t?.label || t?.id || id),
        type: 'system',
      });
    } catch {
      systemThemes.push({ id: String(id), label: String(id), type: 'system' });
    }
  }

  // Load custom themes from database
  const customThemes = await listThemes(routeCtx);
  const customThemeList = customThemes.map((t) => ({
    id: t.id,
    slug: t.slug,
    label: t.label,
    logoUrl: t.logoUrl || null,
    colors: t.colors || null,
    fonts: t.fonts || null,
    isDefault: t.isDefault || false,
    type: 'custom',
  }));

  // Combine and sort (custom first, then system)
  const allThemes = [...customThemeList, ...systemThemes];
  allThemes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'custom' ? -1 : 1;
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
      themeId:
        typeof def.themeId === 'string' && def.themeId.trim()
          ? def.themeId.trim()
          : undefined,
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

/** The language the schema endpoint's `defaults` and `example` describe. */
const SCHEMA_LANG = 'en-GB';

/**
 * GET /api/v1/slide-types/:slideType/schema - Get detailed schema for a slide type.
 * Returns fields with full metadata, defaults, and an example slide structure.
 */
async function handleSlideTypeSchema(ctx, slideType) {
  if (!requirePermission(ctx, 'read')) return true;

  const def = SLIDE_TYPES[slideType];
  if (!def) {
    await apiError(ctx, 404, `Slide type '${slideType}' not found`);
    return true;
  }

  // Build detailed field information
  const fields = (def.fields || []).map((field) => {
    const fieldInfo = {
      key: field.key,
      label: field.label || field.key,
      type: field.type,
      required: field.required === true,
      // Beside `required`, not a second meaning of it (D211).
      essential: field.essential === true,
    };

    // Add optional metadata
    if (field.maxLength) fieldInfo.maxLength = field.maxLength;
    if (field.placeholder) fieldInfo.placeholder = field.placeholder;
    if (field.helpText) fieldInfo.helpText = field.helpText;

    // Add options for enum types
    if (field.type === 'enum' && Array.isArray(field.options)) {
      fieldInfo.options = field.options.map((opt) => {
        if (typeof opt === 'string') return { value: opt, label: opt };
        if (opt && typeof opt === 'object') {
          return {
            value: opt.value ?? opt.label,
            label: opt.label || opt.value,
          };
        }
        return { value: String(opt), label: String(opt) };
      });
    }

    return fieldInfo;
  });

  // One language answers both halves of "what does a new slide of this type
  // contain": `defaults` is what the registry resolves for en-GB, and the
  // example is what the factory makes from that same resolution in an en-GB
  // deck without a theme. Only the slide id is fixed; instance keys (a
  // poll's question and option ids) are minted per call like any new slide.
  // This endpoint describes the core registry, so that is the one it
  // composes from.
  const defaults = resolveTypeDefaults(def, SCHEMA_LANG);
  const example = {
    ...newSlide({
      type: slideType,
      theme: null,
      lang: SCHEMA_LANG,
      slideTypes: SLIDE_TYPES,
    }),
    id: 'example-uuid-00000000',
  };

  await apiSuccess(ctx, {
    slideType,
    label: def.label || slideType,
    fields,
    defaults,
    defaultsByLang: def.defaultsByLang || undefined,
    example,
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
    // A slide-type name, not a row id.
    method: 'GET',
    pattern: /^\/api\/v1\/slide-types\/([^/]+)\/schema$/,
    captures: ['text'],
    handler: handleSlideTypeSchema,
  },
  {
    pattern: /^\/api\/v1\/slide-types\/([^/]+)\/schema$/,
    captures: ['text'],
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
