/**
 * Themes API routes.
 *
 * GET /api/themes - List all themes (system + custom)
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

import { serveJson, badRequest, notFound, requireJsonBody, forbidden } from '../../utils/http.js';
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
import { CURATED_FONTS, getFontsByCategory } from '../../../shared/theme-fonts.js';
import { buildThemeConfig } from '../../utils/theme-builder.js';
import { listAllFontFamiliesWithVariants } from '../../storage/font-families.js';
import { getAppSettings, getDefaultThemeId } from '../../storage/settings.js';
import { getOptionalString, getOptionalObject } from '../../utils/request-validators.js';

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

// GET /api/themes - List all themes (system + custom)
async function handleThemeList({ repoRoot, storageScope, res, authedUser }) {

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
    const curated = systemThemeIds.filter((id) => String(id).startsWith('sandbox-'));
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

  // Annotate with the organization picker allowlist + default so the creation
  // picker can show a default-visible subset and hide the rest behind a
  // "Show all themes" toggle. An empty allowlist means every theme is shown.
  const [{ enabledThemes }, defaultThemeId] = await Promise.all([
    getAppSettings(storageScope),
    getDefaultThemeId(storageScope),
  ]);
  const allowlist = Array.isArray(enabledThemes) ? enabledThemes : [];
  const allowSet = new Set(allowlist.map((id) => String(id).toLowerCase()));

  for (const theme of allThemes) {
    const idLower = String(theme.id).toLowerCase();
    // The default theme is always visible; an empty allowlist shows all.
    theme.enabled =
      allowSet.size === 0 ||
      allowSet.has(idLower) ||
      idLower === String(defaultThemeId).toLowerCase();
  }

  serveJson(res, 200, {
    themes: allThemes,
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
async function handleThemePreviewConfig({ storageScope, req, res, authedUser }) {
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
      managedFonts = await listAllFontFamiliesWithVariants(
        storageScope
      );
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
    { managedFonts }
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
    const messages = {
      invalid_label: 'Invalid theme label',
      invalid_slug: 'Invalid theme slug',
      invalid_colors: 'Invalid color configuration',
      invalid_fonts: 'Invalid font configuration',
      slug_exists: 'A theme with this slug already exists',
      unavailable: 'Database unavailable',
    };
    return badRequest(res, messages[result.reason] || 'Failed to create theme');
  }

  serveJson(res, 201, result.theme);
  return true;
}

// POST /api/themes/custom/clear-default - Clear org default
async function handleCustomThemeClearDefault({ storageScope, res, authedUser }) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const result = await setDefaultTheme(storageScope, null);

  if (!result.ok) {
    return badRequest(res, 'Failed to clear default theme');
  }

  serveJson(res, 200, { success: true });
  return true;
}

// GET /api/themes/custom/:id - Get a custom theme
async function handleCustomThemeGet({ storageScope, res, authedUser }, themeId) {
  const theme = await getThemeRecord(storageScope, themeId);
  if (!theme) {
    return notFound(res, 'Theme not found');
  }
  serveJson(res, 200, theme);
  return true;
}

// PUT /api/themes/custom/:id - Update a custom theme (admin only)
async function handleCustomThemeUpdate({ storageScope, req, res, authedUser }, themeId) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const result = await updateTheme(storageScope, themeId, parsed.body);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return notFound(res, 'Theme not found');
    }
    const messages = {
      invalid_label: 'Invalid theme label',
      invalid_slug: 'Invalid theme slug',
      invalid_colors: 'Invalid color configuration',
      invalid_fonts: 'Invalid font configuration',
      slug_exists: 'A theme with this slug already exists',
      unavailable: 'Database unavailable',
    };
    return badRequest(res, messages[result.reason] || 'Failed to update theme');
  }

  clearCustomThemeCache(themeId);
  serveJson(res, 200, result.theme);
  return true;
}

// DELETE /api/themes/custom/:id - Delete a custom theme (admin only)
async function handleCustomThemeDelete({ storageScope, res, authedUser }, themeId) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const result = await deleteTheme(storageScope, themeId);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return notFound(res, 'Theme not found');
    }
    return badRequest(res, 'Failed to delete theme');
  }

  clearCustomThemeCache(themeId);
  serveJson(res, 200, { success: true });
  return true;
}

// POST /api/themes/custom/:id/set-default - Set as org default (admin only)
async function handleCustomThemeSetDefault({ storageScope, res, authedUser }, themeId) {
  if (!canManageThemes(authedUser)) {
    return forbidden(res, 'Admin access required');
  }

  const result = await setDefaultTheme(storageScope, themeId);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return notFound(res, 'Theme not found');
    }
    return badRequest(res, 'Failed to set default theme');
  }

  serveJson(res, 200, { success: true });
  return true;
}

// GET /api/themes/custom/:id/config - Get theme config for rendering
async function handleCustomThemeConfig({ storageScope, res, authedUser }, themeId) {

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
  { method: 'POST', pattern: '/api/themes/custom/preview-config', handler: handleThemePreviewConfig },
  { method: 'GET', pattern: '/api/themes/custom', handler: handleCustomThemeList },
  { method: 'POST', pattern: '/api/themes/custom', handler: handleCustomThemeCreate },
  { method: 'POST', pattern: '/api/themes/custom/clear-default', handler: handleCustomThemeClearDefault },
  { method: 'GET', pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)$/, handler: handleCustomThemeGet },
  { method: 'PUT', pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)$/, handler: handleCustomThemeUpdate },
  { method: 'DELETE', pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)$/, handler: handleCustomThemeDelete },
  { method: 'POST', pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)\/set-default$/, handler: handleCustomThemeSetDefault },
  { method: 'GET', pattern: /^\/api\/themes\/custom\/([a-f0-9-]+)\/config$/, handler: handleCustomThemeConfig },
];

/**
 * Handle theme API routes. No module-wide guard: the original chain guarded
 * per route (mutations require the designer capability), and that stays in
 * the handlers.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleThemes(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
