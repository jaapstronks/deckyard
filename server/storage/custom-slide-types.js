/**
 * Storage layer for custom slide types.
 * Handles CRUD operations for organization-scoped custom slide type definitions.
 * Follows the same patterns as server/storage/themes.js.
 */

import { getOrgId } from '../utils/context.js';
import { nowIso } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import { parseJson, generateSlug, isValidSlug, getUserIdByEmail } from './utils/helpers.js';

// Valid field types for custom slide types
const VALID_FIELD_TYPES = ['string', 'markdown', 'image', 'images', 'enum', 'items'];
const MAX_FIELDS = 30;
const MAX_LABEL_LEN = 255;

const SELECT_COLUMNS = [
  'id',
  'slug',
  'label',
  'base_type',
  'fields',
  'defaults',
  'defaults_by_lang',
  'template',
  'css',
  'is_published',
  'sort_order',
  'created_at',
  'updated_at',
  'created_by',
];

// ============================================================
// CRUD
// ============================================================

/**
 * List all custom slide types for an organization.
 * @param {Object} ctx - Context with organizationId
 * @returns {Promise<Array>}
 */
export async function listCustomSlideTypes(ctx) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('custom_slide_types')
      .select(SELECT_COLUMNS)
      .where('organization_id', '=', orgId)
      .orderBy('sort_order', 'asc')
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(formatRow);
  });
}

/**
 * List only published custom slide types for an organization.
 * Used by the slide picker and rendering pipeline.
 * @param {Object} ctx - Context with organizationId
 * @returns {Promise<Array>}
 */
export async function listPublishedCustomSlideTypes(ctx) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('custom_slide_types')
      .select(SELECT_COLUMNS)
      .where('organization_id', '=', orgId)
      .where('is_published', '=', true)
      .orderBy('sort_order', 'asc')
      .orderBy('label', 'asc')
      .execute();

    return rows.map(formatRow);
  });
}

/**
 * Get a custom slide type by ID.
 * @param {string} typeId - UUID
 * @param {Object} ctx - Context with organizationId
 * @returns {Promise<Object|null>}
 */
export async function getCustomSlideType(typeId, ctx) {
  if (!typeId || typeof typeId !== 'string') return null;

  return withDbGuard(null, async (db) => {
    let query = db
      .selectFrom('custom_slide_types')
      .select(SELECT_COLUMNS)
      .where('id', '=', typeId);

    if (ctx?.organizationId) {
      query = query.where('organization_id', '=', ctx.organizationId);
    }

    const row = await query.executeTakeFirst();
    return row ? formatRow(row) : null;
  });
}

/**
 * Get a custom slide type by slug.
 * @param {string} slug
 * @param {Object} ctx - Context with organizationId
 * @returns {Promise<Object|null>}
 */
export async function getCustomSlideTypeBySlug(slug, ctx) {
  if (!slug || typeof slug !== 'string') return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('custom_slide_types')
      .select(SELECT_COLUMNS)
      .where('slug', '=', slug)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return row ? formatRow(row) : null;
  });
}

/**
 * Create a custom slide type.
 * @param {Object} data
 * @param {Object} ctx - Context with organizationId and actorEmail
 * @returns {Promise<{ ok: boolean, customSlideType?: Object, reason?: string }>}
 */
export async function createCustomSlideType(data, ctx) {
  const label = String(data?.label || '').trim();
  if (!label || label.length > MAX_LABEL_LEN) {
    return { ok: false, reason: 'invalid_label' };
  }

  let slug = data?.slug ? String(data.slug).trim() : generateSlug(label);
  if (!isValidSlug(slug)) {
    return { ok: false, reason: 'invalid_slug' };
  }

  const fieldsResult = validateFields(data?.fields);
  if (!fieldsResult.ok) {
    return { ok: false, reason: 'invalid_fields' };
  }

  const baseType = data?.baseType ? String(data.baseType).trim() : null;
  const template = data?.template && typeof data.template === 'string' ? data.template : null;
  const css = data?.css && typeof data.css === 'string' ? data.css : null;

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Check slug uniqueness per org
    const existing = await db
      .selectFrom('custom_slide_types')
      .select('id')
      .where('organization_id', '=', orgId)
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existing) {
      return { ok: false, reason: 'slug_exists' };
    }

    const now = nowIso();

    const row = await db
      .insertInto('custom_slide_types')
      .values({
        organization_id: orgId,
        slug,
        label,
        base_type: baseType,
        fields: JSON.stringify(fieldsResult.fields),
        defaults: JSON.stringify(sanitizeDefaults(data?.defaults)),
        defaults_by_lang: data?.defaultsByLang ? JSON.stringify(data.defaultsByLang) : null,
        template,
        css,
        is_published: false,
        sort_order: typeof data?.sortOrder === 'number' ? data.sortOrder : 0,
        created_at: now,
        updated_at: now,
        created_by: ctx?.actorEmail ? await getUserIdByEmail(db, orgId, ctx.actorEmail) : null,
      })
      .returningAll()
      .executeTakeFirst();

    return { ok: true, customSlideType: formatRow(row) };
  });
}

/**
 * Update a custom slide type.
 * @param {string} typeId - UUID
 * @param {Object} updates
 * @param {Object} ctx - Context with organizationId
 * @returns {Promise<{ ok: boolean, customSlideType?: Object, reason?: string }>}
 */
export async function updateCustomSlideType(typeId, updates, ctx) {
  if (!typeId || typeof typeId !== 'string') {
    return { ok: false, reason: 'invalid_id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const updateData = { updated_at: nowIso() };

    if ('label' in updates) {
      const label = String(updates.label || '').trim();
      if (!label || label.length > MAX_LABEL_LEN) {
        return { ok: false, reason: 'invalid_label' };
      }
      updateData.label = label;
    }

    if ('slug' in updates) {
      const slug = String(updates.slug || '').trim();
      if (!isValidSlug(slug)) {
        return { ok: false, reason: 'invalid_slug' };
      }
      const existingSlug = await db
        .selectFrom('custom_slide_types')
        .select('id')
        .where('organization_id', '=', orgId)
        .where('slug', '=', slug)
        .where('id', '!=', typeId)
        .executeTakeFirst();
      if (existingSlug) {
        return { ok: false, reason: 'slug_exists' };
      }
      updateData.slug = slug;
    }

    if ('baseType' in updates) {
      updateData.base_type = updates.baseType ? String(updates.baseType).trim() : null;
    }

    if ('fields' in updates) {
      const fieldsResult = validateFields(updates.fields);
      if (!fieldsResult.ok) {
        return { ok: false, reason: 'invalid_fields' };
      }
      updateData.fields = JSON.stringify(fieldsResult.fields);
    }

    if ('defaults' in updates) {
      updateData.defaults = JSON.stringify(sanitizeDefaults(updates.defaults));
    }

    if ('defaultsByLang' in updates) {
      updateData.defaults_by_lang = updates.defaultsByLang
        ? JSON.stringify(updates.defaultsByLang)
        : null;
    }

    if ('template' in updates) {
      updateData.template = typeof updates.template === 'string' ? updates.template : null;
    }

    if ('css' in updates) {
      updateData.css = typeof updates.css === 'string' ? updates.css : null;
    }

    if ('isPublished' in updates) {
      updateData.is_published = updates.isPublished === true;
    }

    if ('sortOrder' in updates) {
      updateData.sort_order = typeof updates.sortOrder === 'number' ? updates.sortOrder : 0;
    }

    const row = await db
      .updateTable('custom_slide_types')
      .set(updateData)
      .where('id', '=', typeId)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true, customSlideType: formatRow(row) };
  });
}

/**
 * Delete a custom slide type.
 * @param {string} typeId - UUID
 * @param {Object} ctx - Context with organizationId
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function deleteCustomSlideType(typeId, ctx) {
  if (!typeId || typeof typeId !== 'string') {
    return { ok: false, reason: 'invalid_id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('custom_slide_types')
      .where('id', '=', typeId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true };
  });
}

// ============================================================
// HELPERS
// ============================================================

function formatRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    baseType: row.base_type || null,
    fields: parseJson(row.fields, []),
    defaults: parseJson(row.defaults, {}),
    defaultsByLang: parseJson(row.defaults_by_lang, null),
    template: row.template || null,
    css: row.css || null,
    isPublished: Boolean(row.is_published),
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

/**
 * Validate a fields array. Each field must have key, type, label.
 */
function validateFields(fields) {
  if (!Array.isArray(fields)) return { ok: false };
  if (fields.length > MAX_FIELDS) return { ok: false };

  const validated = [];
  const keys = new Set();

  for (const field of fields) {
    if (!field || typeof field !== 'object') return { ok: false };

    const key = String(field.key || '').trim();
    const type = String(field.type || '').trim();
    const label = String(field.label || '').trim();

    if (!key || !type || !label) return { ok: false };
    if (!VALID_FIELD_TYPES.includes(type)) return { ok: false };
    if (keys.has(key)) return { ok: false }; // duplicate keys
    keys.add(key);

    const clean = { key, type, label };
    if (field.required === true) clean.required = true;
    if (typeof field.maxLength === 'number' && field.maxLength > 0) clean.maxLength = field.maxLength;
    if (typeof field.placeholder === 'string') clean.placeholder = field.placeholder;
    if (typeof field.helpText === 'string') clean.helpText = field.helpText;

    if (type === 'enum') {
      if (!Array.isArray(field.options) || field.options.length === 0) return { ok: false };
      clean.options = field.options;
    }

    if (type === 'items') {
      if (!Array.isArray(field.itemFields) || field.itemFields.length === 0) return { ok: false };
      const sub = validateFields(field.itemFields);
      if (!sub.ok) return { ok: false };
      clean.itemFields = sub.fields;
      if (typeof field.minItems === 'number') clean.minItems = field.minItems;
      if (typeof field.maxItems === 'number') clean.maxItems = field.maxItems;
    }

    validated.push(clean);
  }

  return { ok: true, fields: validated };
}

function sanitizeDefaults(defaults) {
  if (!defaults || typeof defaults !== 'object') return {};
  // Deep clone and strip any functions or non-serializable values
  try {
    return JSON.parse(JSON.stringify(defaults));
  } catch {
    return {};
  }
}
