/**
 * Public API v1 - Resources endpoints.
 * Provides access to themes, slide types, and image library.
 */

import { methodNotAllowed } from '../../../utils/http.js';
import { listThemeIds, loadTheme } from '../../../utils/themes.js';
import { sandboxEnabled } from '../../../config/sandbox.js';
import { createRouteContext } from '../../../utils/context.js';
import { listThemes } from '../../../storage/themes.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types.js';
import { requireScope, parsePaginationParams, apiSuccess, apiError } from './middleware.js';

// ============================================================
// ROUTE HANDLERS
// ============================================================

/**
 * GET /api/v1/themes - List available themes.
 */
async function handleThemes(ctx) {
  const { repoRoot, apiKey } = ctx;

  if (!requireScope(ctx, 'read')) return true;

  const routeCtx = createRouteContext({ email: apiKey.ownerEmail });

  // Load system themes from filesystem
  const systemThemeIds = await listThemeIds(repoRoot);
  const filteredSystemIds = sandboxEnabled()
    ? systemThemeIds.filter((id) => String(id).startsWith('sandbox-'))
    : systemThemeIds;

  const systemThemes = [];
  for (const id of filteredSystemIds) {
    try {
      const t = await loadTheme(repoRoot, id);
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
  if (!requireScope(ctx, 'read')) return true;

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

/**
 * GET /api/v1/slide-types/:slideType/schema - Get detailed schema for a slide type.
 * Returns fields with full metadata, defaults, and an example slide structure.
 */
async function handleSlideTypeSchema(ctx, slideType) {
  if (!requireScope(ctx, 'read')) return true;

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

  // Use en-GB defaults if available, otherwise fallback
  const defaults =
    def.defaultsByLang?.['en-GB'] ||
    def.defaultsByLang?.['nl'] ||
    def.defaults ||
    {};

  // Generate an example slide structure
  const example = {
    id: 'example-uuid-00000000',
    type: slideType,
    parentId: null,
    content: { ...defaults },
    notes: '',
    visibility: {},
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
  const { repoRoot, url } = ctx;

  if (!requireScope(ctx, 'read')) return true;

  // Dynamic import to avoid circular dependencies
  const { listImages } = await import('../../../storage/image-library.js');

  const search = url.searchParams.get('search') || '';
  const category = url.searchParams.get('category') || '';
  const { limit, offset } = parsePaginationParams(url);

  const result = await listImages(repoRoot, {
    search,
    category,
    limit,
    offset,
  });

  await apiSuccess(ctx, {
    images: result.images || [],
    categories: result.categories || [],
    pagination: {
      total: result.total || 0,
      limit,
      offset,
      hasMore: offset + limit < (result.total || 0),
    },
  });
  return true;
}

// ============================================================
// MAIN HANDLER
// ============================================================

/**
 * Main handler for /api/v1/themes, /api/v1/slide-types, /api/v1/image-library routes.
 */
export async function handleResources(ctx) {
  const { req, res, url } = ctx;

  // GET /api/v1/themes
  if (url.pathname === '/api/v1/themes') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleThemes(ctx);
  }

  // GET /api/v1/slide-types
  if (url.pathname === '/api/v1/slide-types') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleSlideTypes(ctx);
  }

  // GET /api/v1/slide-types/:slideType/schema
  const schemaMatch = url.pathname.match(/^\/api\/v1\/slide-types\/([^/]+)\/schema$/);
  if (schemaMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleSlideTypeSchema(ctx, schemaMatch[1]);
  }

  // GET /api/v1/image-library
  if (url.pathname === '/api/v1/image-library') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleImageLibrary(ctx);
  }

  return false;
}
