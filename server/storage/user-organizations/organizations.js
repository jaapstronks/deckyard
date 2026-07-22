/**
 * Storage layer for organization CRUD.
 * Handles workspace records: creation, lookup, updates, and deletion.
 */

import { nowIso } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';

// ============================================================
// ORGANIZATION CRUD
// ============================================================

/** Column list shared by all organization-by-X queries. */
const ORG_COLUMNS = [
  'id', 'name', 'slug', 'subdomain', 'custom_domain', 'billing_email',
  'logo_url', 'display_name', 'description', 'settings', 'created_at', 'updated_at',
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
 * Get an organization by subdomain.
 * @param {string} subdomain - Organization subdomain
 * @returns {Promise<Object|null>}
 */
export async function getOrganizationBySubdomain(subdomain) {
  if (!subdomain) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('organizations')
      .select(ORG_COLUMNS)
      .where('subdomain', '=', subdomain.toLowerCase())
      .executeTakeFirst();

    return row ? formatOrganization(row) : null;
  });
}

/**
 * Get an organization by custom domain.
 * @param {string} customDomain - Custom domain
 * @returns {Promise<Object|null>}
 */
export async function getOrganizationByCustomDomain(customDomain) {
  if (!customDomain) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('organizations')
      .select(ORG_COLUMNS)
      .where('custom_domain', '=', customDomain.toLowerCase())
      .executeTakeFirst();

    return row ? formatOrganization(row) : null;
  });
}

/**
 * Create a new organization.
 * @param {Object} data - Organization data
 * @param {string} data.name - Organization name
 * @param {string} data.slug - Unique slug
 * @param {string} [data.subdomain] - Subdomain
 * @param {string} [data.billingEmail] - Billing email
 * @param {string} data.ownerId - User ID of the owner
 * @returns {Promise<Object>}
 */
export async function createOrganization(data) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const slug = String(data.slug || '').toLowerCase().trim();
    const subdomain = data.subdomain ? String(data.subdomain).toLowerCase().trim() : null;

    if (!slug || slug.length < 2) {
      return { ok: false, reason: 'invalid_slug' };
    }

    // Check if slug already exists
    const existingSlug = await db
      .selectFrom('organizations')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existingSlug) {
      return { ok: false, reason: 'slug_taken' };
    }

    // Check if subdomain already exists
    if (subdomain) {
      const existingSubdomain = await db
        .selectFrom('organizations')
        .select('id')
        .where('subdomain', '=', subdomain)
        .executeTakeFirst();

      if (existingSubdomain) {
        return { ok: false, reason: 'subdomain_taken' };
      }
    }

    const now = nowIso();
    const org = await db
      .insertInto('organizations')
      .values({
        name: data.name,
        slug,
        subdomain,
        billing_email: data.billingEmail || null,
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
    if ('billingEmail' in updates) updateData.billing_email = updates.billingEmail;
    if ('logoUrl' in updates) updateData.logo_url = updates.logoUrl;
    if ('settings' in updates) updateData.settings = JSON.stringify(updates.settings);

    // Handle subdomain change with uniqueness check
    if ('subdomain' in updates && updates.subdomain) {
      const newSubdomain = String(updates.subdomain).toLowerCase().trim();
      const existing = await db
        .selectFrom('organizations')
        .select('id')
        .where('subdomain', '=', newSubdomain)
        .where('id', '!=', organizationId)
        .executeTakeFirst();

      if (existing) {
        return { ok: false, reason: 'subdomain_taken' };
      }
      updateData.subdomain = newSubdomain;
    }

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
 * Delete an organization.
 * This will cascade delete all related data.
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object>}
 */
export async function deleteOrganization(organizationId) {
  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Prevent deletion of default organization
    if (organizationId === '00000000-0000-0000-0000-000000000001') {
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
    subdomain: row.subdomain,
    customDomain: row.custom_domain,
    billingEmail: row.billing_email,
    logoUrl: row.logo_url,
    displayName: row.display_name,
    description: row.description,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
