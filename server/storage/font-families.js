/**
 * Storage layer for font families.
 * Handles CRUD operations for organization-scoped custom font management.
 * Follows the same patterns as server/storage/custom-slide-types.js.
 *
 * ## `created_by` is id-only here, on purpose (T10)
 *
 * Unlike `presentations`/`slide_library`/`slide_collections`, whose `created_by`
 * holds an e-mail paired with a `*_user_id` (the identity-decoupling dual key),
 * this table's `created_by` stores a **`users.id` directly** (stamped via
 * `getUserIdByEmail`). That is deliberate: font families have no external
 * writers — only an authenticated in-org user with a `users` row creates one —
 * so there is no external/legacy identity to fall back to an e-mail for, and no
 * dual key is warranted. See shared/identity-match.js for why the dual key
 * exists where external identities *can* appear.
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { nowIso } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import {
  parseJson,
  generateSlug,
  isValidSlug,
  getUserIdByEmail,
} from './utils/helpers.js';

const VALID_SOURCES = ['upload', 'adobe', 'monotype', 'google'];
const VALID_CATEGORIES = ['sans-serif', 'serif', 'display', 'monospace'];
const VALID_STYLES = ['normal', 'italic'];
const VALID_FORMATS = ['woff2', 'woff'];
const MAX_NAME_LEN = 255;

const FAMILY_COLUMNS = [
  'id',
  'name',
  'slug',
  'source',
  'category',
  'source_config',
  'css_fallback',
  'sort_order',
  'created_at',
  'updated_at',
  'created_by',
];

const VARIANT_COLUMNS = [
  'id',
  'font_family_id',
  'weight',
  'style',
  'filename',
  'url',
  'file_size',
  'format',
  'created_at',
];

// ============================================================
// CRUD — Font Families
// ============================================================

/**
 * Get a single font family by ID, with eagerly-loaded variants.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} familyId - The font family ID
 */
export async function getFontFamily(scope, familyId) {
  toStorageContext(scope, 'getFontFamily');
  if (!familyId || typeof familyId !== 'string') return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('font_families')
      .select(FAMILY_COLUMNS)
      .where('id', '=', familyId)
      .where('organization_id', '=', getOrgId(scope))
      .executeTakeFirst();
    if (!row) return null;

    const variants = await db
      .selectFrom('font_variants')
      .select(VARIANT_COLUMNS)
      .where('font_family_id', '=', familyId)
      .orderBy('weight', 'asc')
      .orderBy('style', 'asc')
      .execute();

    return {
      ...formatFamily(row),
      variants: variants.map(formatVariant),
    };
  });
}

/**
 * Create a font family.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} data - Font family data
 */
export async function createFontFamily(scope, data) {
  toStorageContext(scope, 'createFontFamily');
  const name = String(data?.name || '').trim();
  if (!name || name.length > MAX_NAME_LEN) {
    return { ok: false, reason: 'invalid_name' };
  }

  let slug = data?.slug ? String(data.slug).trim() : generateSlug(name);
  if (!isValidSlug(slug)) {
    return { ok: false, reason: 'invalid_slug' };
  }

  const source = String(data?.source || 'upload').trim();
  if (!VALID_SOURCES.includes(source)) {
    return { ok: false, reason: 'invalid_source' };
  }

  const category = String(data?.category || 'sans-serif').trim();
  if (!VALID_CATEGORIES.includes(category)) {
    return { ok: false, reason: 'invalid_category' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    // Check slug uniqueness per org
    const existing = await db
      .selectFrom('font_families')
      .select('id')
      .where('organization_id', '=', orgId)
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existing) {
      return { ok: false, reason: 'slug_exists' };
    }

    const now = nowIso();

    const row = await db
      .insertInto('font_families')
      .values({
        organization_id: orgId,
        name,
        slug,
        source,
        category,
        source_config: JSON.stringify(sanitizeSourceConfig(data?.sourceConfig)),
        css_fallback: data?.cssFallback
          ? String(data.cssFallback).slice(0, 255)
          : null,
        sort_order: typeof data?.sortOrder === 'number' ? data.sortOrder : 0,
        created_at: now,
        updated_at: now,
        created_by: scope?.actorEmail
          ? await getUserIdByEmail(db, orgId, scope.actorEmail)
          : null,
      })
      .returningAll()
      .executeTakeFirst();

    return { ok: true, fontFamily: { ...formatFamily(row), variants: [] } };
  });
}

/**
 * Update a font family.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} familyId - The font family ID
 * @param {Object} updates - Fields to update
 */
export async function updateFontFamily(scope, familyId, updates) {
  toStorageContext(scope, 'updateFontFamily');
  if (!familyId || typeof familyId !== 'string') {
    return { ok: false, reason: 'invalid_id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const updateData = { updated_at: nowIso() };

    if ('name' in updates) {
      const name = String(updates.name || '').trim();
      if (!name || name.length > MAX_NAME_LEN) {
        return { ok: false, reason: 'invalid_name' };
      }
      updateData.name = name;
    }

    if ('slug' in updates) {
      const slug = String(updates.slug || '').trim();
      if (!isValidSlug(slug)) {
        return { ok: false, reason: 'invalid_slug' };
      }
      const existingSlug = await db
        .selectFrom('font_families')
        .select('id')
        .where('organization_id', '=', orgId)
        .where('slug', '=', slug)
        .where('id', '!=', familyId)
        .executeTakeFirst();
      if (existingSlug) {
        return { ok: false, reason: 'slug_exists' };
      }
      updateData.slug = slug;
    }

    if ('category' in updates) {
      const category = String(updates.category || '').trim();
      if (!VALID_CATEGORIES.includes(category)) {
        return { ok: false, reason: 'invalid_category' };
      }
      updateData.category = category;
    }

    if ('sourceConfig' in updates) {
      updateData.source_config = JSON.stringify(
        sanitizeSourceConfig(updates.sourceConfig),
      );
    }

    if ('cssFallback' in updates) {
      updateData.css_fallback = updates.cssFallback
        ? String(updates.cssFallback).slice(0, 255)
        : null;
    }

    if ('sortOrder' in updates) {
      updateData.sort_order =
        typeof updates.sortOrder === 'number' ? updates.sortOrder : 0;
    }

    const row = await db
      .updateTable('font_families')
      .set(updateData)
      .where('id', '=', familyId)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true, fontFamily: formatFamily(row) };
  });
}

/**
 * Delete a font family (cascades to variants).
 * Also clears familyId references from any themes using this font.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} familyId - The font family ID
 */
export async function deleteFontFamily(scope, familyId) {
  toStorageContext(scope, 'deleteFontFamily');
  if (!familyId || typeof familyId !== 'string') {
    return { ok: false, reason: 'invalid_id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    // Get the family first (to return variant URLs for cleanup)
    const family = await db
      .selectFrom('font_families')
      .select(['id', 'source'])
      .where('id', '=', familyId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!family) {
      return { ok: false, reason: 'not_found' };
    }

    // Collect uploaded variant storage keys for cleanup
    let storageKeys = [];
    if (family.source === 'upload') {
      const variants = await db
        .selectFrom('font_variants')
        .select(['filename'])
        .where('font_family_id', '=', familyId)
        .execute();
      storageKeys = variants.map((v) => v.filename).filter(Boolean);
    }

    // Clear familyId references from themes that use this font
    // The fonts column is JSONB; we need to find themes referencing this familyId
    // and clear the familyId (falling back to curated font behavior)
    try {
      const themes = await db
        .selectFrom('themes')
        .select(['id', 'fonts'])
        .where('organization_id', '=', orgId)
        .execute();

      for (const theme of themes) {
        const fonts = parseJson(theme.fonts, {});
        let changed = false;
        if (fonts.headingFamilyId === familyId) {
          delete fonts.headingFamilyId;
          changed = true;
        }
        if (fonts.bodyFamilyId === familyId) {
          delete fonts.bodyFamilyId;
          changed = true;
        }
        if (changed) {
          await db
            .updateTable('themes')
            .set({ fonts, updated_at: nowIso() })
            .where('id', '=', theme.id)
            .execute();
        }
      }
    } catch {
      // Non-critical: theme cleanup failure doesn't block font deletion
    }

    // CASCADE deletes variants
    const result = await db
      .deleteFrom('font_families')
      .where('id', '=', familyId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true, storageKeys };
  });
}

// ============================================================
// CRUD — Font Variants
// ============================================================

/**
 * Add a variant to a font family.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} familyId - The font family ID
 * @param {Object} variantData - Variant data
 */
export async function addFontVariant(scope, familyId, variantData) {
  toStorageContext(scope, 'addFontVariant');
  if (!familyId || typeof familyId !== 'string') {
    return { ok: false, reason: 'invalid_id' };
  }

  const weight = Number(variantData?.weight) || 400;
  if (weight < 100 || weight > 900 || weight % 100 !== 0) {
    return { ok: false, reason: 'invalid_weight' };
  }

  const style = String(variantData?.style || 'normal').trim();
  if (!VALID_STYLES.includes(style)) {
    return { ok: false, reason: 'invalid_style' };
  }

  const format = String(variantData?.format || 'woff2').trim();
  if (!VALID_FORMATS.includes(format)) {
    return { ok: false, reason: 'invalid_format' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    // Verify family belongs to org
    const family = await db
      .selectFrom('font_families')
      .select('id')
      .where('id', '=', familyId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!family) {
      return { ok: false, reason: 'not_found' };
    }

    // Check uniqueness of weight+style
    const existing = await db
      .selectFrom('font_variants')
      .select('id')
      .where('font_family_id', '=', familyId)
      .where('weight', '=', weight)
      .where('style', '=', style)
      .executeTakeFirst();

    if (existing) {
      return { ok: false, reason: 'variant_exists' };
    }

    const row = await db
      .insertInto('font_variants')
      .values({
        font_family_id: familyId,
        weight,
        style,
        filename: variantData?.filename
          ? String(variantData.filename).slice(0, 512)
          : null,
        url: variantData?.url ? String(variantData.url).slice(0, 2048) : null,
        file_size:
          typeof variantData?.fileSize === 'number'
            ? variantData.fileSize
            : null,
        format,
        created_at: nowIso(),
      })
      .returningAll()
      .executeTakeFirst();

    // Update family's updated_at
    await db
      .updateTable('font_families')
      .set({ updated_at: nowIso() })
      .where('id', '=', familyId)
      .execute();

    return { ok: true, variant: formatVariant(row) };
  });
}

/**
 * Remove a font variant.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} variantId - The font variant ID
 */
export async function removeFontVariant(scope, variantId) {
  toStorageContext(scope, 'removeFontVariant');
  if (!variantId || typeof variantId !== 'string') {
    return { ok: false, reason: 'invalid_id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    // Verify variant belongs to a family in this org
    const variant = await db
      .selectFrom('font_variants')
      .innerJoin(
        'font_families',
        'font_families.id',
        'font_variants.font_family_id',
      )
      .select([
        'font_variants.id',
        'font_variants.url',
        'font_variants.filename',
        'font_variants.font_family_id',
      ])
      .where('font_variants.id', '=', variantId)
      .where('font_families.organization_id', '=', orgId)
      .executeTakeFirst();

    if (!variant) {
      return { ok: false, reason: 'not_found' };
    }

    await db.deleteFrom('font_variants').where('id', '=', variantId).execute();

    // Update family's updated_at
    await db
      .updateTable('font_families')
      .set({ updated_at: nowIso() })
      .where('id', '=', variant.font_family_id)
      .execute();

    // Return storage key (stored in filename) for media provider cleanup
    return { ok: true, storageKey: variant.filename || null };
  });
}

/**
 * List all font families with their full variant arrays.
 * Used by theme editor for font selection.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 */
export async function listAllFontFamiliesWithVariants(scope) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);

    const families = await db
      .selectFrom('font_families')
      .select(FAMILY_COLUMNS)
      .where('organization_id', '=', orgId)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .execute();

    if (!families.length) return [];

    const familyIds = families.map((f) => f.id);
    const variants = await db
      .selectFrom('font_variants')
      .select(VARIANT_COLUMNS)
      .where('font_family_id', 'in', familyIds)
      .orderBy('weight', 'asc')
      .orderBy('style', 'asc')
      .execute();

    const variantMap = {};
    for (const v of variants) {
      if (!variantMap[v.font_family_id]) variantMap[v.font_family_id] = [];
      variantMap[v.font_family_id].push(formatVariant(v));
    }

    return families.map((f) => ({
      ...formatFamily(f),
      variants: variantMap[f.id] || [],
    }));
  });
}

// ============================================================
// HELPERS
// ============================================================

function formatFamily(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    source: row.source,
    category: row.category,
    sourceConfig: parseJson(row.source_config, {}),
    cssFallback: row.css_fallback || null,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function formatVariant(row) {
  return {
    id: row.id,
    fontFamilyId: row.font_family_id,
    weight: row.weight,
    style: row.style,
    filename: row.filename,
    url: row.url,
    fileSize: row.file_size,
    format: row.format,
    createdAt: row.created_at,
  };
}

function sanitizeSourceConfig(config) {
  if (!config || typeof config !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(config));
  } catch {
    return {};
  }
}
