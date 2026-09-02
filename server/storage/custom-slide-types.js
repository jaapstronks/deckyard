/**
 * Storage layer for custom slide types.
 * Handles CRUD operations for organization-scoped custom slide type definitions.
 * Follows the same patterns as server/storage/themes.js.
 *
 * ## `created_by` is id-only here, on purpose (T10)
 *
 * Unlike `presentations`/`slide_library`/`slide_collections`, whose `created_by`
 * holds an e-mail paired with a `*_user_id` (the identity-decoupling dual key),
 * this table's `created_by` stores a **`users.id` directly** (stamped via
 * `getUserIdByEmail`). That is deliberate: custom slide types have no external
 * writers — only an authenticated in-org user with a `users` row creates one —
 * so there is no external/legacy identity to fall back to an e-mail for, and no
 * dual key is warranted. See shared/identity-match.js for why the dual key
 * exists where external identities *can* appear.
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { nowIso } from '../utils/normalize.js';
import {
  NO_DISPLAY_NAMES,
  resolveNamesForAddresses,
  toStoredActorIdentity,
} from './display-identity.js';
import {
  withDbGuard,
  parseJson,
  generateSlug,
  isValidSlug,
  getUserIdByEmail,
} from './utils/index.js';
import { validateUsage } from '../../shared/slide-types/usage.js';
import { validateCustomFieldDefinitions } from '../../shared/slide-types/custom-field-definitions.js';

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
  'usage',
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
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @returns {Promise<Array>}
 */
export async function listCustomSlideTypes(scope) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);

    const rows = await db
      .selectFrom('custom_slide_types')
      .select(SELECT_COLUMNS)
      .where('organization_id', '=', orgId)
      .orderBy('sort_order', 'asc')
      .orderBy('created_at', 'desc')
      .execute();

    const lookup = await creatorNames(rows);
    return rows.map((row) => formatRow(row, lookup));
  });
}

/**
 * List only published custom slide types for an organization.
 * Used by the slide picker and rendering pipeline.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @returns {Promise<Array>}
 */
export async function listPublishedCustomSlideTypes(scope) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);

    const rows = await db
      .selectFrom('custom_slide_types')
      .select(SELECT_COLUMNS)
      .where('organization_id', '=', orgId)
      .where('is_published', '=', true)
      .orderBy('sort_order', 'asc')
      .orderBy('label', 'asc')
      .execute();

    const lookup = await creatorNames(rows);
    return rows.map((row) => formatRow(row, lookup));
  });
}

/**
 * Get a custom slide type by ID.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} typeId - UUID
 * @returns {Promise<Object|null>}
 */
export async function getCustomSlideType(scope, typeId) {
  toStorageContext(scope, 'getCustomSlideType');
  if (!typeId || typeof typeId !== 'string') return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('custom_slide_types')
      .select(SELECT_COLUMNS)
      .where('id', '=', typeId)
      .where('organization_id', '=', getOrgId(scope))
      .executeTakeFirst();
    return row ? formatRow(row, await creatorNames([row])) : null;
  });
}

/**
 * Create a custom slide type.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} data
 * @returns {Promise<{ ok: boolean, customSlideType?: Object, reason?: string }>}
 */
export async function createCustomSlideType(scope, data) {
  toStorageContext(scope, 'createCustomSlideType');
  const label = String(data?.label || '').trim();
  if (!label || label.length > MAX_LABEL_LEN) {
    return { ok: false, reason: 'invalid', field: 'label' };
  }

  let slug = data?.slug ? String(data.slug).trim() : generateSlug(label);
  if (!isValidSlug(slug)) {
    return { ok: false, reason: 'invalid', field: 'slug' };
  }

  const fieldsResult = validateCustomFieldDefinitions(data?.fields);
  if (!fieldsResult.ok) {
    return invalidFields(fieldsResult.problem);
  }

  const baseType = data?.baseType ? String(data.baseType).trim() : null;
  const template =
    data?.template && typeof data.template === 'string' ? data.template : null;
  const css = data?.css && typeof data.css === 'string' ? data.css : null;

  // Rejected rather than truncated: an author is standing right here, and a
  // silently shortened rule is worse than a refused save. The tolerant half of
  // that pair guards the fork load path instead (see shared/slide-types/usage.js).
  const usageResult = validateUsage(data?.usage);
  if (!usageResult.ok) {
    // `field` rides on `invalid` and on nothing else, so it is forwarded only
    // when the validator set one (D52).
    return usageResult.field
      ? { ok: false, reason: usageResult.reason, field: usageResult.field }
      : { ok: false, reason: usageResult.reason };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

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
        defaults_by_lang: data?.defaultsByLang
          ? JSON.stringify(data.defaultsByLang)
          : null,
        template,
        css,
        usage: usageResult.usage,
        is_published: false,
        sort_order: typeof data?.sortOrder === 'number' ? data.sortOrder : 0,
        created_at: now,
        updated_at: now,
        created_by: scope?.actorEmail
          ? await getUserIdByEmail(db, orgId, scope.actorEmail)
          : null,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      customSlideType: formatRow(row, await creatorNames([row])),
    };
  });
}

/**
 * Update a custom slide type.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} typeId - UUID
 * @param {Object} updates
 * @returns {Promise<{ ok: boolean, customSlideType?: Object, reason?: string }>}
 */
export async function updateCustomSlideType(scope, typeId, updates) {
  toStorageContext(scope, 'updateCustomSlideType');
  if (!typeId || typeof typeId !== 'string') {
    return { ok: false, reason: 'invalid', field: 'id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const updateData = { updated_at: nowIso() };

    if ('label' in updates) {
      const label = String(updates.label || '').trim();
      if (!label || label.length > MAX_LABEL_LEN) {
        return { ok: false, reason: 'invalid', field: 'label' };
      }
      updateData.label = label;
    }

    if ('slug' in updates) {
      const slug = String(updates.slug || '').trim();
      if (!isValidSlug(slug)) {
        return { ok: false, reason: 'invalid', field: 'slug' };
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
      updateData.base_type = updates.baseType
        ? String(updates.baseType).trim()
        : null;
    }

    if ('fields' in updates) {
      const fieldsResult = validateCustomFieldDefinitions(updates.fields);
      if (!fieldsResult.ok) {
        return invalidFields(fieldsResult.problem);
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
      updateData.template =
        typeof updates.template === 'string' ? updates.template : null;
    }

    if ('css' in updates) {
      updateData.css = typeof updates.css === 'string' ? updates.css : null;
    }

    if ('usage' in updates) {
      const usageResult = validateUsage(updates.usage);
      if (!usageResult.ok) {
        return usageResult.field
          ? { ok: false, reason: usageResult.reason, field: usageResult.field }
          : { ok: false, reason: usageResult.reason };
      }
      updateData.usage = usageResult.usage;
    }

    if ('isPublished' in updates) {
      updateData.is_published = updates.isPublished === true;
    }

    if ('sortOrder' in updates) {
      updateData.sort_order =
        typeof updates.sortOrder === 'number' ? updates.sortOrder : 0;
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

    return {
      ok: true,
      customSlideType: formatRow(row, await creatorNames([row])),
    };
  });
}

/**
 * Set the display order of the organization's custom slide types.
 *
 * `listCustomSlideTypes` has always ordered by `sort_order`, but nothing ever
 * wrote it, so every type sat at 0 and the list fell through to its created_at
 * tiebreaker. This is the write half: the caller sends the ids in the order it
 * wants, and each one's position becomes its sort_order.
 *
 * Partial ids are rejected rather than applied, so a stale client (one that
 * loaded before someone else added a type) can't silently drop the type it
 * never saw to the bottom.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string[]} orderedIds - Every custom type id, in the desired order.
 * @returns {Promise<{ ok: boolean, reason?: string, customSlideTypes?: Array }>}
 */
export async function reorderCustomSlideTypes(scope, orderedIds) {
  toStorageContext(scope, 'reorderCustomSlideTypes');
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { ok: false, reason: 'invalid', field: 'order' };
  }
  const ids = orderedIds.map((id) => String(id || '').trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    return { ok: false, reason: 'invalid', field: 'order' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

    const existing = await db
      .selectFrom('custom_slide_types')
      .select('id')
      .where('organization_id', '=', orgId)
      .execute();
    const known = new Set(existing.map((r) => r.id));

    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      return { ok: false, reason: 'order_mismatch' };
    }

    const stamp = nowIso();
    for (let i = 0; i < ids.length; i += 1) {
      await db
        .updateTable('custom_slide_types')
        .set({ sort_order: i, updated_at: stamp })
        .where('id', '=', ids[i])
        .where('organization_id', '=', orgId)
        .execute();
    }

    return { ok: true, customSlideTypes: await listCustomSlideTypes(scope) };
  });
}

/**
 * Delete a custom slide type.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {string} typeId - UUID
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function deleteCustomSlideType(scope, typeId) {
  toStorageContext(scope, 'deleteCustomSlideType');
  if (!typeId || typeof typeId !== 'string') {
    return { ok: false, reason: 'invalid', field: 'id' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);

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

/**
 * @param {object} row - Database row
 * @param {import('./display-identity.js').DisplayNameLookup} [lookup] -
 *   Resolved display names; omitted derives them from the stored address.
 * @returns {object}
 */
function formatRow(row, lookup = NO_DISPLAY_NAMES) {
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
    usage: row.usage || null,
    isPublished: Boolean(row.is_published),
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Who authored this type is named, not addressed (D22): this table has no
    // creator id column, so the id comes from the same lookup that resolved
    // the name. See storage/display-identity.js.
    createdBy: toStoredActorIdentity(row.created_by, null, lookup),
  };
}

/**
 * The display names this batch of rows needs for its `created_by` addresses.
 * @param {Array<Object>} rows
 * @returns {Promise<import('./display-identity.js').DisplayNameLookup>}
 */
function creatorNames(rows) {
  return resolveNamesForAddresses((rows || []).map((row) => row?.created_by));
}

/**
 * The `invalid` result for a rejected `fields[]`, carrying the located problem
 * so the route can say which field is wrong instead of "Invalid field
 * definitions." — the copy that made Save look like it did nothing (B200).
 *
 * @param {import('../../shared/slide-types/custom-field-definitions.js').FieldDefinitionProblem} problem
 * @returns {{ok: false, reason: 'invalid', field: 'fields', fieldProblem: Object}}
 */
function invalidFields(problem) {
  return {
    ok: false,
    reason: 'invalid',
    field: 'fields',
    fieldProblem: problem,
  };
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
