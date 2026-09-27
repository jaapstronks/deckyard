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
import { sandboxEnabled } from '../../config/sandbox.js';
import { dispatchRoutes } from '../../utils/router.js';
import { canManage } from '../../utils/route-middleware.js';
import {
  listThemes,
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
import { THEME_FIELD_PROBLEMS } from '../../../shared/theme-config-schema.js';
import { listAllFontFamiliesWithVariants } from '../../storage/font-families.js';
import {
  getDefaultThemeId,
  getEnabledThemeIds,
} from '../../storage/settings.js';
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
async function handleThemeList({
  repoRoot,
  storageScope,
  url,
  res,
  authedUser,
}) {
  const records = await listThemes(storageScope);
  const visible = sandboxEnabled()
    ? records.filter((theme) => theme.source === 'seed')
    : records;
  const themesBySource = visible.map((t) => ({
    id: t.id,
    slug: t.slug,
    source: t.source,
    label: t.label,
    logoUrl: t.logoUrl,
    colors: t.colors,
    fonts: t.fonts,
  }));
  const allThemes = themesBySource;
  allThemes.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'organization' ? -1 : 1;
    return String(a.label).localeCompare(String(b.label));
  });

  // Enforce the organization allowlist (D70). `enabledThemes` has one meaning:
  // a theme outside it is not offered anywhere, so the filter lives here rather
  // than as an annotation each picker is free to soften. An empty allowlist
  // means none is configured — every theme is offered.
  const [allowlist, defaultThemeId] = await Promise.all([
    getEnabledThemeIds(storageScope),
    getDefaultThemeId(storageScope),
  ]);
  const allowSet = new Set(allowlist);
  // The default theme is always offered, or a workspace could allowlist itself
  // out of the theme its own new decks get.
  allowSet.add(String(defaultThemeId).toLowerCase());

  // `?current=<id>` keeps one extra theme in the list: the theme a deck is
  // already on. A deck that predates a withdrawal keeps rendering and keeps
  // showing its own selection instead of silently reading as something else.
  // No validation beyond casing and a length cap: the value is only ever a
  // lookup key into the theme list, so an unknown id widens the allowlist by
  // exactly nothing.
  const current = String(url?.searchParams?.get('current') || '')
    .trim()
    .toLowerCase()
    .slice(0, 64);
  if (current) allowSet.add(current);

  // `?all=1` returns the unfiltered list for the Settings → Themes allowlist
  // editor, which cannot offer a checkbox for a theme it can't see. Only for
  // users who may manage themes — otherwise it is the leak D70 closes.
  const wantsAll =
    url?.searchParams?.get('all') === '1' && canManageThemes(authedUser);

  const themes =
    wantsAll || allowlist.length === 0
      ? allThemes
      : allThemes.filter((theme) =>
          allowSet.has(String(theme.id).toLowerCase()),
        );
  for (const theme of themes) theme.isDefault = theme.id === defaultThemeId;

  serveJson(res, 200, {
    themes,
    defaultThemeId,
    enabledThemes: allowlist,
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
  serveJson(res, 200, theme);
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
