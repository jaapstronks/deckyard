/**
 * Themes API routes.
 *
 * GET /api/themes - List all themes (system + custom)
 * GET /api/themes/fonts - List available fonts for custom themes
 * GET /api/themes/custom - List custom themes only
 * GET /api/themes/custom/:id - Get a custom theme
 * POST /api/themes/custom - Create a custom theme (admin only)
 * PUT /api/themes/custom/:id - Update a custom theme (admin only)
 * DELETE /api/themes/custom/:id - Delete a custom theme (admin only)
 * POST /api/themes/custom/:id/set-default - Set as org default (admin only)
 * POST /api/themes/custom/clear-default - Clear org default (admin only)
 * GET /api/themes/preview-css - Generate CSS for preview
 */

import { serveJson, badRequest, notFound, parseJsonBody, forbidden } from '../../utils/http.js';
import { listThemeIds, loadTheme, clearCustomThemeCache } from '../../utils/themes.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { createRouteContext } from '../../utils/context.js';
import {
  listThemes,
  getTheme,
  createTheme,
  updateTheme,
  deleteTheme,
  setDefaultTheme,
} from '../../storage/themes.js';
import { CURATED_FONTS, getFontsByCategory } from '../../../shared/theme-fonts.js';
import { buildThemeConfig, generatePreviewCSS } from '../../utils/theme-builder.js';
import { listAllFontFamiliesWithVariants } from '../../storage/font-families.js';
import { readAppSettings, getDefaultThemeId } from '../../storage/settings.js';

/**
 * Check if user can manage themes.
 * Requires designer capability (which includes admins and owners by default).
 * @param {Object} authedUser - Authenticated user
 * @returns {boolean}
 */
function canManageThemes(authedUser) {
  return authedUser?.isDesigner === true || authedUser?.isAdmin === true;
}

export async function handleThemes({ repoRoot, req, res, url, authedUser }) {
  const pathname = url.pathname;

  // ============================================================
  // GET /api/themes - List all themes (system + custom)
  // ============================================================
  if (pathname === '/api/themes' && req.method === 'GET') {
    const ctx = createRouteContext(authedUser);

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
    const customThemes = await listThemes(ctx);
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

    // Annotate with the workspace picker allowlist + default so the creation
    // picker can show a default-visible subset and hide the rest behind a
    // "Show all themes" toggle. An empty allowlist means every theme is shown.
    const [{ enabledThemes }, defaultThemeId] = await Promise.all([
      readAppSettings(repoRoot),
      getDefaultThemeId(repoRoot),
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

  // ============================================================
  // GET /api/themes/fonts - List available fonts
  // ============================================================
  if (pathname === '/api/themes/fonts' && req.method === 'GET') {
    const grouped = getFontsByCategory();
    serveJson(res, 200, {
      fonts: CURATED_FONTS,
      grouped,
    });
    return true;
  }

  // ============================================================
  // GET /api/themes/preview-css - Generate CSS for live preview
  // ============================================================
  if (pathname === '/api/themes/preview-css' && req.method === 'GET') {
    const colors = {
      primary: url.searchParams.get('primary') || '#3B82F6',
      background: url.searchParams.get('background') || '#ffffff',
      textLight: url.searchParams.get('textLight') || '#ffffff',
      textDark: url.searchParams.get('textDark') || '#1f2937',
    };
    const fonts = {
      heading: url.searchParams.get('headingFont') || 'Inter',
      body: url.searchParams.get('bodyFont') || 'Inter',
      headingFamilyId: url.searchParams.get('headingFamilyId') || null,
      bodyFamilyId: url.searchParams.get('bodyFamilyId') || null,
    };

    // Fetch managed fonts if any familyId is referenced
    let managedFonts;
    if (fonts.headingFamilyId || fonts.bodyFamilyId) {
      try {
        const ctx = createRouteContext(authedUser);
        managedFonts = await listAllFontFamiliesWithVariants(ctx);
      } catch {
        // Fall back to no managed fonts
      }
    }

    const css = generatePreviewCSS({ colors, fonts, managedFonts });
    res.setHeader('Content-Type', 'text/css');
    res.end(css);
    return true;
  }

  // ============================================================
  // GET /api/themes/custom - List custom themes only
  // ============================================================
  if (pathname === '/api/themes/custom' && req.method === 'GET') {
    const ctx = createRouteContext(authedUser);
    const themes = await listThemes(ctx);
    serveJson(res, 200, { themes });
    return true;
  }

  // ============================================================
  // POST /api/themes/custom - Create a custom theme (admin only)
  // ============================================================
  if (pathname === '/api/themes/custom' && req.method === 'POST') {
    if (!canManageThemes(authedUser)) {
      return forbidden(res, 'Admin access required');
    }

    const ctx = createRouteContext(authedUser);
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
      return badRequest(res, parsed.error || 'Invalid request body');
    }

    const result = await createTheme(parsed.body, ctx);

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

  // ============================================================
  // POST /api/themes/custom/clear-default - Clear org default
  // ============================================================
  if (pathname === '/api/themes/custom/clear-default' && req.method === 'POST') {
    if (!canManageThemes(authedUser)) {
      return forbidden(res, 'Admin access required');
    }

    const ctx = createRouteContext(authedUser);
    const result = await setDefaultTheme(null, ctx);

    if (!result.ok) {
      return badRequest(res, 'Failed to clear default theme');
    }

    serveJson(res, 200, { success: true });
    return true;
  }

  // ============================================================
  // Custom theme routes with ID parameter
  // ============================================================
  const customThemeMatch = pathname.match(/^\/api\/themes\/custom\/([a-f0-9-]+)$/);
  if (customThemeMatch) {
    const themeId = customThemeMatch[1];
    const ctx = createRouteContext(authedUser);

    // GET /api/themes/custom/:id - Get a custom theme
    if (req.method === 'GET') {
      const theme = await getTheme(themeId, ctx);
      if (!theme) {
        return notFound(res, 'Theme not found');
      }
      serveJson(res, 200, theme);
      return true;
    }

    // PUT /api/themes/custom/:id - Update a custom theme
    if (req.method === 'PUT') {
      if (!canManageThemes(authedUser)) {
        return forbidden(res, 'Admin access required');
      }

      const parsed = await parseJsonBody(req);
      if (!parsed.ok) {
        return badRequest(res, parsed.error || 'Invalid request body');
      }
      const result = await updateTheme(themeId, parsed.body, ctx);

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

    // DELETE /api/themes/custom/:id - Delete a custom theme
    if (req.method === 'DELETE') {
      if (!canManageThemes(authedUser)) {
        return forbidden(res, 'Admin access required');
      }

      const result = await deleteTheme(themeId, ctx);

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
  }

  // ============================================================
  // POST /api/themes/custom/:id/set-default - Set as org default
  // ============================================================
  const setDefaultMatch = pathname.match(/^\/api\/themes\/custom\/([a-f0-9-]+)\/set-default$/);
  if (setDefaultMatch && req.method === 'POST') {
    if (!canManageThemes(authedUser)) {
      return forbidden(res, 'Admin access required');
    }

    const themeId = setDefaultMatch[1];
    const ctx = createRouteContext(authedUser);

    const result = await setDefaultTheme(themeId, ctx);

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return notFound(res, 'Theme not found');
      }
      return badRequest(res, 'Failed to set default theme');
    }

    serveJson(res, 200, { success: true });
    return true;
  }

  // ============================================================
  // GET /api/themes/custom/:id/config - Get theme config for rendering
  // ============================================================
  const configMatch = pathname.match(/^\/api\/themes\/custom\/([a-f0-9-]+)\/config$/);
  if (configMatch && req.method === 'GET') {
    const themeId = configMatch[1];
    const ctx = createRouteContext(authedUser);

    const theme = await getTheme(themeId, ctx);
    if (!theme) {
      return notFound(res, 'Theme not found');
    }

    // Fetch managed fonts if the theme references any familyId
    let managedFonts;
    const fonts = theme.fonts || {};
    if (fonts.headingFamilyId || fonts.bodyFamilyId) {
      try {
        managedFonts = await listAllFontFamiliesWithVariants(ctx);
      } catch {
        // Fall back to no managed fonts
      }
    }

    const config = buildThemeConfig(theme, { managedFonts });
    serveJson(res, 200, config);
    return true;
  }

  return false;
}
