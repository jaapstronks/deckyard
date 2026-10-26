/**
 * Themes API routes.
 *
 * GET /api/themes - List the visible theme records,
 *   filtered by the `enabledThemes` allowlist. `?current=<id>` keeps a deck's
 *   own theme in the list; `?all=1` (managers only) skips the filter.
 * GET /api/themes/fonts - List available fonts for custom themes
 * POST /api/themes/preview-config - Build a theme from an unsaved draft
 * GET /api/themes/:id - Get a visible theme record
 * POST /api/themes - Create an organization theme (designer only)
 * PUT /api/themes/:id - Update an organization theme (designer only)
 * DELETE /api/themes/:id - Delete an organization theme (designer only)
 * GET /api/themes/:id/config - Build the render configuration
 * GET /api/themes/:id/template.pptx - Download the theme's PPTX template
 */

import {
  forbidden,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  withErrorHandler,
} from '../../utils/http.js';
import { clearCustomThemeCache } from '../../utils/themes.js';
import { dispatchRoutes } from '../../utils/router.js';
import { canManage } from '../../utils/route-middleware.js';
import {
  getThemeRecord,
  createTheme,
  updateTheme,
  deleteTheme,
} from '../../storage/themes.js';
import {
  CURATED_FONTS,
  getFontsByCategory,
} from '../../../shared/theme-fonts.js';
import { buildThemeConfig } from '../../utils/theme-builder.js';
import { prepareThemeTemplate } from '../../services/exports.js';
import {
  handleExportError,
  sendExportResponse,
} from '../../export/pipeline.js';
import { THEME_FIELD_PROBLEMS } from '../../../shared/theme-config-schema.js';
import { listAllFontFamiliesWithVariants } from '../../storage/font-families.js';
import { getDefaultThemeId } from '../../storage/settings.js';
import { listOfferedThemes } from '../../services/theme.js';
import {
  getOptionalString,
  getOptionalObject,
} from '../../utils/request-validators.js';

/**
 * Human-readable text per theme-mutation failure reason.
 *
 * Status is not here — it comes from the reason's `REASONS` entry
 * (`server/storage/reasons.js`). The two copies of this map that used to sit
 * inline in the create and update handlers ended in `badRequest(...)`, so
 * `unavailable` shipped its honest message *"Database unavailable"* under a
 * `400 bad_request` envelope. It is a 503 now.
 */
const THEME_FAILURE_MESSAGES = {
  not_found: 'Theme not found',
  slug_exists: 'A theme with this slug already exists',
  unavailable: 'Database unavailable',
};

/**
 * Human-readable text per `field` when the reason is `invalid`.
 *
 * D48 collapsed four generic `invalid_*` spellings into one `invalid` carrying
 * a `field`; D52 collapsed the rest, so the copy that used to hang off the
 * suffix hangs off the field name instead. The field also reaches the client as
 * `details.field`, which is more than the suffix gave it.
 */
const INVALID_FIELD_MESSAGES = {
  label: 'Invalid theme label',
  slug: 'Invalid theme slug',
  colors: 'Invalid color configuration',
  fonts: 'Invalid font configuration',
  id: 'Invalid theme ID',
};

/** Sentence opener per refused-field sub-code (`fieldProblem.code`). */
const FIELD_PROBLEM_PREFIX = {
  [THEME_FIELD_PROBLEMS.unknown]: 'Unknown theme field',
  [THEME_FIELD_PROBLEMS.invalid]: 'Invalid theme field',
};

/**
 * Answer a failed theme mutation in the canonical envelope.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{reason: string, field?: string}} result
 * @returns {true}
 */
function themeError(res, result) {
  // No reason guard around the field lookup: `field` only ever rides on
  // `invalid`, and the vocabulary gate is what keeps that true. A refused
  // theme field is named whole in the sentence (`config.logos.logoAlt`):
  // the record refuses a field it does not know, or a value it cannot hold,
  // by name (D209). `details.reason` carries which of the two.
  const message = result.where
    ? `${FIELD_PROBLEM_PREFIX[result.fieldProblem?.code] || 'Invalid theme field'}: ${result.where}`
    : INVALID_FIELD_MESSAGES[result.field] ||
      THEME_FAILURE_MESSAGES[result.reason];
  return storageError(res, result, message);
}

/**
 * Check if user can manage themes.
 * Requires designer capability (which includes admins and owners by default).
 *
 * The same rule as custom slide types and font families, so it is the same
 * function: this was a hand-copied duplicate of `canManage()`, and a duplicate
 * of an authorization check is a place for the two to drift apart.
 *
 * @param {Object} authedUser - Authenticated user
 * @returns {boolean}
 */
function canManageThemes(authedUser) {
  return canManage(authedUser);
}

// GET /api/themes - List the themes this workspace offers
async function handleThemeList({ storageScope, url, res, authedUser }) {
  const { themes: offered, enabledThemes } = await listOfferedThemes(
    storageScope,
    {
      currentThemeId: url?.searchParams?.get('current'),
      // The settings editor needs the complete catalog; the existing management
      // gate stays on this adapter and is never inferred by v1 or MCP.
      includeAll:
        url?.searchParams?.get('all') === '1' && canManageThemes(authedUser),
    },
  );
  const themes = offered.map((theme) => ({
    id: theme.id,
    slug: theme.slug,
    source: theme.source,
    label: theme.label,
    logoUrl: theme.logoUrl,
    colors: theme.colors,
    fonts: theme.fonts,
    isDefault: theme.isDefault,
  }));

  // The default is named once, on the theme itself (`isDefault`), as on
  // `GET /api/themes/:id` and `/api/v1/themes` (B584).
  serveJson(res, 200, {
    themes,
    enabledThemes,
  });
  return true;
}

// GET /api/themes/fonts - List available fonts
function handleThemeFonts({ res }) {
  const grouped = getFontsByCategory();
  serveJson(res, 200, {
    fonts: CURATED_FONTS,
    grouped,
  });
  return true;
}

// POST /api/themes/preview-config - Build a theme from an unsaved draft.
// The theme editor needs to render real slides against settings that have not
// been saved yet. Deriving the tokens client-side would be a second copy of
// the colour maths, which is exactly the drift #118 removed — so the draft is
// built through the same `buildThemeConfig` production uses.
async function handleThemePreviewConfig({
  storageScope,
  req,
  res,
  authedUser,
}) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  // An empty body previews the theme defaults, so it is a legitimate request.
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;

  // requireJsonBody guarantees a plain object (empty body → {}).
  const draft = parsed.body;

  // Managed fonts, when the draft references one by id.
  let managedFonts;
  const fonts = getOptionalObject(draft, 'fonts') || {};
  if (fonts.headingFamilyId || fonts.bodyFamilyId) {
    try {
      managedFonts = await listAllFontFamiliesWithVariants(storageScope);
    } catch {
      // Fall back to no managed fonts
    }
  }

  // A draft has no row of its own; give it a placeholder identity so the
  // built theme has the shape the client renderer expects.
  const theme = buildThemeConfig(
    {
      id: 'preview',
      slug: 'preview',
      label: getOptionalString(draft, 'label') ?? 'Preview',
      logoUrl: draft.logoUrl || null,
      logoSmallUrl: draft.logoSmallUrl || null,
      colors: draft.colors,
      fonts,
      config: draft.config,
    },
    { managedFonts },
  );

  serveJson(res, 200, { theme });
  return true;
}

// POST /api/themes - Create an organization theme (designer only)
async function handleCustomThemeCreate({ storageScope, req, res, authedUser }) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;

  const result = await createTheme(storageScope, parsed.body);

  if (!result.ok) {
    return themeError(res, result);
  }

  serveJson(res, 201, result.theme);
  return true;
}

// GET /api/themes/:id - Get a visible theme record
async function handleCustomThemeGet(
  { storageScope, res, authedUser },
  themeId,
) {
  const theme = await getThemeRecord(storageScope, themeId);
  if (!theme) {
    return notFound(res, 'Theme not found');
  }
  const defaultThemeId = await getDefaultThemeId(storageScope);
  serveJson(res, 200, { ...theme, isDefault: theme.id === defaultThemeId });
  return true;
}

// PUT /api/themes/:id - Update an organization theme (designer only)
async function handleCustomThemeUpdate(
  { storageScope, req, res, authedUser },
  themeId,
) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const result = await updateTheme(storageScope, themeId, parsed.body);

  if (!result.ok) {
    return themeError(res, result);
  }

  clearCustomThemeCache(themeId);
  serveJson(res, 200, result.theme);
  return true;
}

// DELETE /api/themes/:id - Delete an organization theme (designer only)
async function handleCustomThemeDelete(
  { storageScope, res, authedUser },
  themeId,
) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const result = await deleteTheme(storageScope, themeId);

  if (!result.ok) {
    return themeError(res, result);
  }

  clearCustomThemeCache(themeId);
  serveJson(res, 200, { success: true });
  return true;
}

// GET /api/themes/:id/config - Get theme config for rendering
async function handleCustomThemeConfig(
  { storageScope, res, authedUser },
  themeId,
) {
  const theme = await getThemeRecord(storageScope, themeId);
  if (!theme) {
    return notFound(res, 'Theme not found');
  }

  // Fetch managed fonts if the theme references any familyId
  let managedFonts;
  const fonts = theme.fonts || {};
  if (fonts.headingFamilyId || fonts.bodyFamilyId) {
    try {
      managedFonts = await listAllFontFamiliesWithVariants(storageScope);
    } catch {
      // Fall back to no managed fonts
    }
  }

  const config = buildThemeConfig(theme, { managedFonts });
  serveJson(res, 200, config);
  return true;
}

/**
 * GET /api/themes/:id/template.pptx — the theme's PPTX template.
 *
 * A download of the theme, not of a deck (B274): the bytes depend on the
 * theme alone, so this is where the artifact lives and the themes overview is
 * where it is offered. The read right is the service's: an id this scope
 * cannot see answers the same 404 as an id that does not exist.
 */
async function handleThemeTemplate({ storageScope, res }, themeId) {
  try {
    const { buffer, label } = await prepareThemeTemplate(storageScope, themeId);
    sendExportResponse(res, {
      contentType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      filename: label,
      extension: '-template.pptx',
      data: buffer,
    });
  } catch (e) {
    handleExportError(res, e);
  }
  return true;
}

/**
 * Declarative route table for `/api/themes*` (A7.19 C8). Order matches the
 * previous if-chain: exact paths precede the UUID capture. Mutations require
 * the designer capability in their handlers.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/themes', handler: handleThemeList },
  { method: 'GET', pattern: '/api/themes/fonts', handler: handleThemeFonts },
  {
    method: 'POST',
    pattern: '/api/themes/preview-config',
    handler: handleThemePreviewConfig,
  },
  {
    method: 'POST',
    pattern: '/api/themes',
    handler: handleCustomThemeCreate,
  },
  {
    method: 'GET',
    pattern: /^\/api\/themes\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleCustomThemeGet,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/themes\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleCustomThemeUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/themes\/([^/]+)$/,
    captures: ['uuid'],
    handler: handleCustomThemeDelete,
  },
  {
    method: 'GET',
    pattern: /^\/api\/themes\/([^/]+)\/config$/,
    captures: ['uuid'],
    handler: handleCustomThemeConfig,
  },
  {
    method: 'GET',
    pattern: /^\/api\/themes\/([^/]+)\/template\.pptx$/,
    captures: ['uuid'],
    handler: handleThemeTemplate,
  },
];

/**
 * Handle theme API routes. No module-wide guard: the original chain guarded
 * per route (mutations require the designer capability), and that stays in
 * the handlers.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleThemes = withErrorHandler('themes', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
