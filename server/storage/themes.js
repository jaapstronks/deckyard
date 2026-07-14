/**
 * Storage layer for custom themes.
 * Handles CRUD operations for organization-scoped themes.
 */

import { getOrgId } from '../utils/context.js';
import { nowIso } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import { isValidSlug } from './utils/helpers.js';
import { isValidFont, DEFAULT_HEADING_FONT, DEFAULT_BODY_FONT } from '../../shared/theme-fonts.js';

/**
 * Verify that font familyIds referenced in fonts config exist in the org.
 * @param {Object} db - Database instance
 * @param {string} orgId - Organization ID
 * @param {Object} fonts - Validated fonts config
 * @returns {Promise<boolean>} - Whether all referenced familyIds exist
 */
async function verifyFontFamilyIds(db, orgId, fonts) {
  const idsToCheck = [];
  if (fonts.headingFamilyId) idsToCheck.push(fonts.headingFamilyId);
  if (fonts.bodyFamilyId) idsToCheck.push(fonts.bodyFamilyId);
  if (idsToCheck.length === 0) return true;

  const unique = [...new Set(idsToCheck)];
  const rows = await db
    .selectFrom('font_families')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('id', 'in', unique)
    .execute();

  return rows.length === unique.length;
}

// ============================================================
// THEME CRUD
// ============================================================

/**
 * List all themes for an organization.
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of themes
 */
export async function listThemes(ctx) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('themes')
      .select([
        'id',
        'slug',
        'label',
        'logo_url',
        'logo_small_url',
        'colors',
        'fonts',
        'is_default',
        'created_at',
        'updated_at',
        'created_by',
      ])
      .where('organization_id', '=', orgId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(formatTheme);
  });
}

/**
 * Get a theme by ID.
 * When ctx is provided with an organizationId, filters by org for security.
 * When ctx is empty/null (e.g., during rendering), loads by UUID directly.
 * @param {string} themeId - The theme ID (UUID)
 * @param {Object} ctx - Context object (optional for UUID lookup)
 * @returns {Promise<Object|null>} - Theme object or null
 */
export async function getTheme(themeId, ctx) {
  if (!themeId || typeof themeId !== 'string') return null;

  return withDbGuard(null, async (db) => {
    let query = db
      .selectFrom('themes')
      .select([
        'id',
        'organization_id',
        'slug',
        'label',
        'logo_url',
        'logo_small_url',
        'colors',
        'fonts',
        'is_default',
        'created_at',
        'updated_at',
        'created_by',
      ])
      .where('id', '=', themeId);

    // If org context is explicitly provided, filter by it for security
    // Otherwise, load by UUID directly (for rendering contexts)
    // UUIDs are globally unique, so this is safe for read-only operations
    if (ctx?.organizationId) {
      query = query.where('organization_id', '=', ctx.organizationId);
    }

    const row = await query.executeTakeFirst();

    return row ? formatTheme(row) : null;
  });
}

/**
 * Get a theme by slug.
 * @param {string} slug - The theme slug
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - Theme object or null
 */
export async function getThemeBySlug(slug, ctx) {
  if (!slug || typeof slug !== 'string') return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('themes')
      .select([
        'id',
        'slug',
        'label',
        'logo_url',
        'logo_small_url',
        'colors',
        'fonts',
        'is_default',
        'created_at',
        'updated_at',
        'created_by',
      ])
      .where('slug', '=', slug)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return row ? formatTheme(row) : null;
  });
}

/**
 * Get the default theme for an organization.
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - Default theme or null
 */
export async function getDefaultTheme(ctx) {
  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('themes')
      .select([
        'id',
        'slug',
        'label',
        'logo_url',
        'logo_small_url',
        'colors',
        'fonts',
        'is_default',
        'created_at',
        'updated_at',
        'created_by',
      ])
      .where('organization_id', '=', orgId)
      .where('is_default', '=', true)
      .executeTakeFirst();

    return row ? formatTheme(row) : null;
  });
}

/**
 * Create a new theme.
 * @param {Object} data - Theme data
 * @param {string} data.label - Display name
 * @param {string} [data.slug] - URL-safe identifier (auto-generated if not provided)
 * @param {string} [data.logoUrl] - Logo URL
 * @param {Object} [data.colors] - Color configuration
 * @param {Object} [data.fonts] - Font configuration
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with ok flag and theme or reason
 */
export async function createTheme(data, ctx) {
  const label = String(data?.label || '').trim();
  if (!label || label.length > 255) {
    return { ok: false, reason: 'invalid_label' };
  }

  // Generate or validate slug
  let slug = data?.slug ? String(data.slug).trim() : generateSlug(label);
  if (!isValidSlug(slug)) {
    return { ok: false, reason: 'invalid_slug' };
  }

  // Validate colors
  const colors = validateColors(data?.colors);
  if (!colors) {
    return { ok: false, reason: 'invalid_colors' };
  }

  // Validate fonts
  const fonts = validateFonts(data?.fonts);
  if (!fonts) {
    return { ok: false, reason: 'invalid_fonts' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Check if slug already exists
    const existing = await db
      .selectFrom('themes')
      .select('id')
      .where('organization_id', '=', orgId)
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existing) {
      return { ok: false, reason: 'slug_exists' };
    }

    // Verify referenced font familyIds exist
    if (!(await verifyFontFamilyIds(db, orgId, fonts))) {
      return { ok: false, reason: 'invalid_fonts' };
    }

    const now = nowIso();

    const row = await db
      .insertInto('themes')
      .values({
        organization_id: orgId,
        slug,
        label,
        logo_url: data?.logoUrl || null,
        logo_small_url: data?.logoSmallUrl || null,
        colors,
        fonts,
        is_default: false,
        created_at: now,
        updated_at: now,
        created_by: ctx?.actorEmail ? await getUserIdByEmail(db, orgId, ctx.actorEmail) : null,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      theme: formatTheme(row),
    };
  });
}

/**
 * Update a theme.
 * @param {string} themeId - The theme ID
 * @param {Object} updates - Fields to update
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with ok flag and theme or reason
 */
export async function updateTheme(themeId, updates, ctx) {
  if (!themeId || typeof themeId !== 'string') {
    return { ok: false, reason: 'invalid_id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Build update data
    const updateData = {
      updated_at: nowIso(),
    };

    if ('label' in updates) {
      const label = String(updates.label || '').trim();
      if (!label || label.length > 255) {
        return { ok: false, reason: 'invalid_label' };
      }
      updateData.label = label;
    }

    if ('slug' in updates) {
      const slug = String(updates.slug || '').trim();
      if (!isValidSlug(slug)) {
        return { ok: false, reason: 'invalid_slug' };
      }

      // Check if new slug already exists (different from this theme)
      const existingSlug = await db
        .selectFrom('themes')
        .select('id')
        .where('organization_id', '=', orgId)
        .where('slug', '=', slug)
        .where('id', '!=', themeId)
        .executeTakeFirst();

      if (existingSlug) {
        return { ok: false, reason: 'slug_exists' };
      }

      updateData.slug = slug;
    }

    if ('logoUrl' in updates) {
      updateData.logo_url = updates.logoUrl || null;
    }

    if ('logoSmallUrl' in updates) {
      updateData.logo_small_url = updates.logoSmallUrl || null;
    }

    if ('colors' in updates) {
      const colors = validateColors(updates.colors);
      if (!colors) {
        return { ok: false, reason: 'invalid_colors' };
      }
      updateData.colors = colors;
    }

    if ('fonts' in updates) {
      const fonts = validateFonts(updates.fonts);
      if (!fonts) {
        return { ok: false, reason: 'invalid_fonts' };
      }
      // Verify referenced font familyIds exist
      if (!(await verifyFontFamilyIds(db, orgId, fonts))) {
        return { ok: false, reason: 'invalid_fonts' };
      }
      updateData.fonts = fonts;
    }

    const row = await db
      .updateTable('themes')
      .set(updateData)
      .where('id', '=', themeId)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      theme: formatTheme(row),
    };
  });
}

/**
 * Delete a theme.
 * @param {string} themeId - The theme ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with ok flag or reason
 */
export async function deleteTheme(themeId, ctx) {
  if (!themeId || typeof themeId !== 'string') {
    return { ok: false, reason: 'invalid_id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('themes')
      .where('id', '=', themeId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true };
  });
}

/**
 * Set a theme as the default for the organization.
 * @param {string} themeId - The theme ID (or null to clear default)
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with ok flag or reason
 */
export async function setDefaultTheme(themeId, ctx) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Clear existing default
    await db
      .updateTable('themes')
      .set({ is_default: false, updated_at: nowIso() })
      .where('organization_id', '=', orgId)
      .where('is_default', '=', true)
      .execute();

    if (themeId) {
      // Set new default
      const result = await db
        .updateTable('themes')
        .set({ is_default: true, updated_at: nowIso() })
        .where('id', '=', themeId)
        .where('organization_id', '=', orgId)
        .executeTakeFirst();

      if (result.numUpdatedRows === 0n) {
        return { ok: false, reason: 'not_found' };
      }
    }

    return { ok: true };
  });
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Format a database row into a theme object.
 * @param {Object} row - Database row
 * @returns {Object} - Formatted theme
 */
function formatTheme(row) {
  const out = {
    id: row.id,
    slug: row.slug,
    label: row.label,
    logoUrl: row.logo_url,
    logoSmallUrl: row.logo_small_url,
    colors: row.colors || {},
    fonts: row.fonts || {},
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
  if (row.organization_id) out.organizationId = row.organization_id;
  return out;
}

/**
 * Generate a URL-safe slug from a label.
 * @param {string} label - Theme label
 * @returns {string} - URL-safe slug
 */
function generateSlug(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Validate and normalize color configuration.
 * @param {Object} colors - Color configuration
 * @returns {Object|null} - Normalized colors or null if invalid
 */
function validateColors(colors) {
  if (!colors || typeof colors !== 'object') {
    return {
      primary: '#3B82F6',
      background: '#ffffff',
      textLight: '#ffffff',
      textDark: '#1f2937',
    };
  }

  const normalized = {};

  // Validate each color
  const colorKeys = ['primary', 'background', 'textLight', 'textDark'];
  for (const key of colorKeys) {
    if (colors[key]) {
      const color = String(colors[key]).trim();
      if (!isValidHexColor(color)) {
        return null;
      }
      normalized[key] = color;
    }
  }

  // Apply defaults for missing colors
  return {
    primary: normalized.primary || '#3B82F6',
    background: normalized.background || '#ffffff',
    textLight: normalized.textLight || '#ffffff',
    textDark: normalized.textDark || '#1f2937',
  };
}

/**
 * Validate and normalize font configuration.
 * When headingFamilyId or bodyFamilyId is present, skip curated-list validation
 * for that font (it's a managed font, validated by the route handler).
 * @param {Object} fonts - Font configuration
 * @returns {Object|null} - Normalized fonts or null if invalid
 */
function validateFonts(fonts) {
  if (!fonts || typeof fonts !== 'object') {
    return {
      heading: DEFAULT_HEADING_FONT,
      body: DEFAULT_BODY_FONT,
    };
  }

  const normalized = {};

  // Validate heading font
  if (fonts.heading) {
    // If headingFamilyId is present, this is a managed font — skip curated validation
    if (fonts.headingFamilyId) {
      normalized.heading = fonts.heading;
      normalized.headingFamilyId = fonts.headingFamilyId;
    } else if (!isValidFont(fonts.heading)) {
      return null;
    } else {
      normalized.heading = fonts.heading;
    }
  }

  // Validate body font
  if (fonts.body) {
    // If bodyFamilyId is present, this is a managed font — skip curated validation
    if (fonts.bodyFamilyId) {
      normalized.body = fonts.body;
      normalized.bodyFamilyId = fonts.bodyFamilyId;
    } else if (!isValidFont(fonts.body)) {
      return null;
    } else {
      normalized.body = fonts.body;
    }
  }

  const result = {
    heading: normalized.heading || DEFAULT_HEADING_FONT,
    body: normalized.body || DEFAULT_BODY_FONT,
  };

  // Preserve familyId references if present
  if (normalized.headingFamilyId) result.headingFamilyId = normalized.headingFamilyId;
  if (normalized.bodyFamilyId) result.bodyFamilyId = normalized.bodyFamilyId;

  return result;
}

/**
 * Check if a string is a valid hex color.
 * @param {string} color - Color string
 * @returns {boolean}
 */
function isValidHexColor(color) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
}

/**
 * Get user ID by email (for created_by field).
 * @param {Object} db - Database instance
 * @param {string} orgId - Organization ID
 * @param {string} email - User email
 * @returns {Promise<string|null>} - User ID or null
 */
async function getUserIdByEmail(db, orgId, email) {
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('email', '=', email)
    .executeTakeFirst();

  return user?.id || null;
}
