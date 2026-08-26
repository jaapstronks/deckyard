/**
 * Themes API routes.
 *
 * GET /api/themes - List the themes this workspace offers (system + custom),
 *   filtered by the `enabledThemes` allowlist. `?current=<id>` keeps a deck's
 *   own theme in the list; `?all=1` (managers only) skips the filter.
 * GET /api/themes/fonts - List available fonts for custom themes
 * GET /api/themes/custom - List custom themes only
 * POST /api/themes/custom/preview-config - Build a theme from an unsaved draft
 * GET /api/themes/custom/:id - Get a custom theme
 * POST /api/themes/custom - Create a custom theme (admin only)
 * PUT /api/themes/custom/:id - Update a custom theme (admin only)
 * DELETE /api/themes/custom/:id - Delete a custom theme (admin only)
 * POST /api/themes/custom/:id/set-default - Set as org default (admin only)
 * POST /api/themes/custom/clear-default - Clear org default (admin only)
 */

import {
  forbidden,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  withErrorHandler,
} from '../../utils/http.js';
import {
  listThemeIds,
  listCoreThemeIds,
  loadThemeAssets,
  clearCustomThemeCache,
} from '../../utils/themes.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { dispatchRoutes } from '../../utils/router.js';
import { canManage } from '../../utils/route-middleware.js';
import {
  listThemes,
  getThemeRecord,
  createTheme,
  updateTheme,
  deleteTheme,
  setDefaultTheme,
} from '../../storage/themes.js';
import {
  CURATED_FONTS,
  getFontsByCategory,
} from '../../../shared/theme-fonts.js';
import { buildThemeConfig } from '../../utils/theme-builder.js';
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

/**
 * Answer a failed theme mutation in the canonical envelope.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{reason: string, field?: string}} result
 * @returns {true}
 */
function themeError(res, result) {
  // No reason guard around the field lookup: `field` only ever rides on
  // `invalid`, and the vocabulary gate is what keeps that true.
  const message =
    INVALID_FIELD_MESSAGES[result.field] ||
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
  // Load system themes from filesystem. Sandbox is a public, neutral
  // playground, so it lists only the built-in core themes (never filesystem
  // custom/branded ones under custom/themes) — and, when present, narrows to
  // a curated `sandbox-*` subset an operator can drop in. Falls back to the
  // full core set when no `sandbox-*` themes exist, so the picker is never
  // empty and guests can always choose a theme.
  const systemThemeIds = sandboxEnabled()
    ? await listCoreThemeIds(repoRoot)
    : await listThemeIds(repoRoot);
  let filteredSystemIds = systemThemeIds;
  if (sandboxEnabled()) {
    const curated = systemThemeIds.filter((id) =>
      String(id).startsWith('sandbox-'),
    );
    filteredSystemIds = curated.length ? curated : systemThemeIds;
  }

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

  // Load custom themes from database. Sandbox is a public, neutral
  // playground, so it deliberately hides organization custom themes (which may
  // carry a customer's branding) and shows only the built-in system themes.
  const customThemes = sandboxEnabled() ? [] : await listThemes(storageScope);
  const customThemeList = customThemes.map((t) => ({
    id: t.id,
    slug: t.slug,
    label: t.label,
    logoUrl: t.logoUrl,
    colors: t.colors,
    fonts: t.fonts,
    isDefault: t.isDefault,
    type: 'custom',
  }));

  // Combine and sort
  const allThemes = [...customThemeList, ...systemThemes];
  allThemes.sort((a, b) => {
    // Custom themes first, then system themes
    if (a.type !== b.type) return a.type === 'custom' ? -1 : 1;
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

// POST /api/themes/custom/preview-config - Build a theme from an unsaved draft.
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

// GET /api/themes/custom - List custom themes only
async function handleCustomThemeList({ storageScope, res, authedUser }) {
  const themes = await listThemes(storageScope);
  serveJson(res, 200, { themes });
  return true;
}

// POST /api/themes/custom - Create a custom theme (admin only)
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

// POST /api/themes/custom/clear-default - Clear org default
async function handleCustomThemeClearDefault({
  storageScope,
  res,
  authedUser,
}) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const result = await setDefaultTheme(storageScope, null);

  if (!result.ok) {
    return themeError(res, result);
  }

  serveJson(res, 200, { success: true });
  return true;
}

// GET /api/themes/custom/:id - Get a custom theme
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

// PUT /api/themes/custom/:id - Update a custom theme (admin only)
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

// DELETE /api/themes/custom/:id - Delete a custom theme (admin only)
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

// POST /api/themes/custom/:id/set-default - Set as org default (admin only)
async function handleCustomThemeSetDefault(
  { storageScope, res, authedUser },
  themeId,
) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const result = await setDefaultTheme(storageScope, themeId);

  if (!result.ok) {
    return themeError(res, result);
  }

  serveJson(res, 200, { success: true });
  return true;
}

// GET /api/themes/custom/:id/config - Get theme config for rendering
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
 * previous if-chain — the exact `custom/preview-config` and
 * `custom/clear-default` paths come before the `custom/:id` rows, as they did
 * as if-branches. Every path fell through on a method mismatch (Form A), so
 * there are no 405 catch-all rows. Per-route designer guards
 * (`canManageThemes`) live in the handlers, where the original ran them.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/themes', handler: handleThemeList },
  { method: 'GET', pattern: '/api/themes/fonts', handler: handleThemeFonts },
  {
    method: 'POST',
    pattern: '/api/themes/custom/preview-config',
    handler: handleThemePreviewConfig,
  },
  {
    method: 'GET',
    pattern: '/api/themes/custom',
    handler: handleCustomThemeList,
  },
  {
    method: 'POST',
    pattern: '/api/themes/custom',
    handler: handleCustomThemeCreate,
  },
  {
    method: 'POST',
    pattern: '/api/themes/custom/clear-default',
    handler: handleCustomThemeClearDefault,
  },
  {
    method: 'GET',
    pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)$/,
    handler: handleCustomThemeGet,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)$/,
    handler: handleCustomThemeUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)$/,
    handler: handleCustomThemeDelete,
  },
  {
    method: 'POST',
    pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)\/set-default$/,
    handler: handleCustomThemeSetDefault,
  },
  {
    method: 'GET',
    pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)\/config$/,
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
