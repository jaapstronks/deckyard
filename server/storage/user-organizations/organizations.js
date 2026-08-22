/**
 * Storage layer for organization CRUD.
 * Handles organization records: creation, lookup, updates, and deletion.
 */

import { nowIso } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';
import { getDefaultOrganizationId } from '../../config/database.js';

// ============================================================
// ORGANIZATION CRUD
// ============================================================

/** Column list shared by all organization-by-X queries. */
const ORG_COLUMNS = [
  'id',
  'name',
  'slug',
  'logo_url',
  'display_name',
  'description',
  'settings',
  'created_at',
  'updated_at',
];

/**
 * Get an organization by ID.
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object|null>}
 */
export async function getOrganizationById(organizationId) {
  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('organizations')
      .select(ORG_COLUMNS)
      .where('id', '=', organizationId)
      .executeTakeFirst();

    return row ? formatOrganization(row) : null;
  });
}

/**
 * Create a new organization.
 * @param {Object} data - Organization data
 * @param {string} data.name - Organization name
 * @param {string} data.slug - Unique slug
 * @param {string} [data.displayName] - Display name, may differ from `name`
 * @param {string} [data.description] - Organization description
 * @param {string} data.ownerId - User ID of the owner
 * @returns {Promise<Object>}
 */
export async function createOrganization(data) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const slug = String(data.slug || '')
      .toLowerCase()
      .trim();

    if (!slug || slug.length < 2) {
      return { ok: false, reason: 'invalid', field: 'slug' };
    }

    // Check if slug already exists
    const existingSlug = await db
      .selectFrom('organizations')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existingSlug) {
      return { ok: false, reason: 'slug_exists' };
    }

    const now = nowIso();
    const org = await db
      .insertInto('organizations')
      .values({
        name: data.name,
        slug,
        display_name: data.displayName || null,
        description: data.description || null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    // Add the creator as owner
    await db
      .insertInto('user_organizations')
      .values({
        user_id: data.ownerId,
        organization_id: org.id,
        role: 'owner',
        joined_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();

    return {
      ok: true,
      organization: formatOrganization(org),
    };
  });
}

/**
 * Update an organization.
 * @param {string} organizationId - Organization ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
export async function updateOrganization(organizationId, updates) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const updateData = {
      updated_at: nowIso(),
    };

    if ('name' in updates) updateData.name = updates.name;
    if ('displayName' in updates) updateData.display_name = updates.displayName;
    if ('description' in updates) updateData.description = updates.description;
    if ('logoUrl' in updates) updateData.logo_url = updates.logoUrl;
    if ('settings' in updates)
      updateData.settings = JSON.stringify(updates.settings);

    const row = await db
      .updateTable('organizations')
      .set(updateData)
      .where('id', '=', organizationId)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      organization: formatOrganization(row),
    };
  });
}

/**
 * Whether this is the organization every single-organization path falls back to.
 *
 * It is the one organization that may not be deleted, and it is configurable
 * (`DEFAULT_ORGANIZATION_ID`), so the check has to ask for it rather than
 * repeat the seed UUID: on an instance that sets the variable, hard-coding the
 * seed value protects an organization that may not even exist and leaves the
 * real fallback deletable.
 *
 * @param {string} organizationId - Organization ID
 * @returns {boolean}
 */
export function isDefaultOrganization(organizationId) {
  return (
    Boolean(organizationId) && organizationId === getDefaultOrganizationId()
  );
}

/**
 * Delete an organization.
 * This will cascade delete all related data.
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object>}
 */
export async function deleteOrganization(organizationId) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Prevent deletion of default organization
    if (isDefaultOrganization(organizationId)) {
      return { ok: false, reason: 'cannot_delete_default' };
    }

    const deleted = await db
      .deleteFrom('organizations')
      .where('id', '=', organizationId)
      .returning('id')
      .executeTakeFirst();

    if (!deleted) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true };
  });
}

// ============================================================
// HELPERS
// ============================================================

function formatOrganization(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    displayName: row.display_name,
    description: row.description,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
