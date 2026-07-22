/**
 * API routes for organization management (multi-workspace mode).
 * All routes are guarded by the MULTI_WORKSPACE_ENABLED feature flag.
 */

import { getUserFromRequestAsync, updateSessionOrganization } from '../../auth/auth.js';
import { json, serveJson, badRequest, unauthorized, forbidden, notFound } from '../../utils/http.js';
import { createRouteContext, isReservedSubdomain } from '../../utils/context.js';
import { isMultiWorkspaceEnabled } from '../../config/features.js';
import {
  listUserOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getMembership,
  hasWorkspaceRole,
} from '../../storage/user-organizations.js';
import { getUserByEmail } from '../../storage/users.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('organizations');

// ============================================================
// HELPERS
// ============================================================

/**
 * Validate slug format.
 * Slug must be 2-63 characters, lowercase alphanumeric with hyphens.
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  // 2-63 chars, lowercase alphanumeric, hyphens allowed but not at start/end
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]{1,2}$/.test(slug);
}

/**
 * Validate subdomain format.
 * Same rules as slug, plus cannot be a reserved subdomain.
 * @param {string} subdomain
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateSubdomain(subdomain) {
  if (!subdomain) return { valid: true }; // Subdomain is optional

  const normalized = String(subdomain).toLowerCase().trim();

  if (!isValidSlug(normalized)) {
    return { valid: false, reason: 'invalid_format' };
  }

  if (isReservedSubdomain(normalized)) {
    return { valid: false, reason: 'reserved' };
  }

  return { valid: true };
}

export async function handleOrganizations({ repoRoot, req, res, url, authedUser }) {
  // Only handle /api/organizations routes
  if (!url.pathname.startsWith('/api/organizations')) {
    return false;
  }

  // Feature flag guard - return 403 if multi-workspace is not enabled
  if (!isMultiWorkspaceEnabled()) {
    return forbidden(res, 'Multi-workspace features are not enabled');
  }

  const ctx = createRouteContext(authedUser);
  ctx.repoRoot = repoRoot;

  // Get the authenticated user with database info
  const user = authedUser || (await getUserFromRequestAsync(req, ctx));
  if (!user) {
    return unauthorized(res, 'Authentication required');
  }

  // Get user's database record for ID
  const dbUser = await getUserByEmail(user.email, ctx);
  if (!dbUser) {
    return unauthorized(res, 'User not found');
  }

  const userId = dbUser.id;

  // ============================================================
  // GET /api/organizations - List user's organizations
  // ============================================================
  if (url.pathname === '/api/organizations' && req.method === 'GET') {
    try {
      const organizations = await listUserOrganizations(userId);
      serveJson(res, 200, { organizations });
      return true;
    } catch (err) {
      log.error('[organizations] Failed to list organizations:', err);
      serveJson(res, 500, { error: 'Failed to load organizations' });
      return true;
    }
  }

  // ============================================================
  // POST /api/organizations - Create a new organization
  // ============================================================
  if (url.pathname === '/api/organizations' && req.method === 'POST') {
    try {
      const body = await json(req);
      const name = String(body?.name || '').trim();
      const slug = String(body?.slug || '').toLowerCase().trim();
      const subdomain = body?.subdomain ? String(body.subdomain).toLowerCase().trim() : null;
      const billingEmail = body?.billingEmail ? String(body.billingEmail).trim() : null;
      const displayName = body?.displayName ? String(body.displayName).trim() : null;
      const description = body?.description ? String(body.description).trim() : null;

      if (!name || name.length < 2) {
        return badRequest(res, 'Organization name must be at least 2 characters');
      }

      if (!isValidSlug(slug)) {
        return badRequest(res, 'Slug must be 2-63 characters, lowercase alphanumeric with optional hyphens');
      }

      const subdomainValidation = validateSubdomain(subdomain);
      if (!subdomainValidation.valid) {
        if (subdomainValidation.reason === 'reserved') {
          return badRequest(res, 'This subdomain is reserved');
        }
        return badRequest(res, 'Invalid subdomain format');
      }

      const result = await createOrganization({
        name,
        slug,
        subdomain,
        billingEmail,
        displayName,
        description,
        ownerId: userId,
      });

      if (!result.ok) {
        if (result.reason === 'slug_taken') {
          return badRequest(res, 'An organization with this slug already exists');
        }
        if (result.reason === 'subdomain_taken') {
          return badRequest(res, 'This subdomain is already in use');
        }
        return badRequest(res, 'Failed to create organization');
      }

      serveJson(res, 201, {
        ok: true,
        organization: result.organization,
      });
      return true;
    } catch (err) {
      log.error('[organizations] Failed to create organization:', err);
      serveJson(res, 500, { error: 'Failed to create organization' });
      return true;
    }
  }

  // ============================================================
  // GET /api/organizations/:id - Get organization details
  // ============================================================
  const orgMatch = url.pathname.match(/^\/api\/organizations\/([^/]+)$/);
  if (orgMatch && req.method === 'GET') {
    try {
      const orgId = orgMatch[1];

      // Check membership
      const membership = await getMembership(userId, orgId);
      if (!membership) {
        return forbidden(res, 'You are not a member of this organization');
      }

      const organization = await getOrganizationById(orgId);
      if (!organization) {
        return notFound(res);
      }

      serveJson(res, 200, {
        organization,
        membership: {
          role: membership.role,
          joinedAt: membership.joinedAt,
        },
      });
      return true;
    } catch (err) {
      log.error('[organizations] Failed to get organization:', err);
      serveJson(res, 500, { error: 'Failed to load organization' });
      return true;
    }
  }

  // ============================================================
  // PATCH /api/organizations/:id - Update organization
  // ============================================================
  if (orgMatch && req.method === 'PATCH') {
    try {
      const orgId = orgMatch[1];

      // Check membership and admin permission
      const membership = await getMembership(userId, orgId);
      if (!membership) {
        return forbidden(res, 'You are not a member of this organization');
      }

      if (!hasWorkspaceRole(membership.role, 'admin')) {
        return forbidden(res, 'Admin or owner access required');
      }

      const body = await json(req);
      const updates = {};

      if ('name' in body) {
        const name = String(body.name || '').trim();
        if (name.length < 2) {
          return badRequest(res, 'Organization name must be at least 2 characters');
        }
        updates.name = name;
      }

      if ('displayName' in body) {
        updates.displayName = body.displayName ? String(body.displayName).trim() : null;
      }

      if ('description' in body) {
        updates.description = body.description ? String(body.description).trim() : null;
      }

      if ('billingEmail' in body) {
        updates.billingEmail = body.billingEmail ? String(body.billingEmail).trim() : null;
      }

      if ('logoUrl' in body) {
        updates.logoUrl = body.logoUrl ? String(body.logoUrl).trim() : null;
      }

      // Only owners can change subdomain
      if ('subdomain' in body) {
        if (membership.role !== 'owner') {
          return forbidden(res, 'Only the owner can change the subdomain');
        }

        const subdomain = body.subdomain ? String(body.subdomain).toLowerCase().trim() : null;
        const subdomainValidation = validateSubdomain(subdomain);
        if (!subdomainValidation.valid) {
          if (subdomainValidation.reason === 'reserved') {
            return badRequest(res, 'This subdomain is reserved');
          }
          return badRequest(res, 'Invalid subdomain format');
        }
        updates.subdomain = subdomain;
      }

      if (Object.keys(updates).length === 0) {
        return badRequest(res, 'No valid updates provided');
      }

      const result = await updateOrganization(orgId, updates);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          return notFound(res);
        }
        if (result.reason === 'subdomain_taken') {
          return badRequest(res, 'This subdomain is already in use');
        }
        return badRequest(res, 'Failed to update organization');
      }

      serveJson(res, 200, { ok: true, organization: result.organization });
      return true;
    } catch (err) {
      log.error('[organizations] Failed to update organization:', err);
      serveJson(res, 500, { error: 'Failed to update organization' });
      return true;
    }
  }

  // ============================================================
  // DELETE /api/organizations/:id - Delete organization
  // ============================================================
  if (orgMatch && req.method === 'DELETE') {
    try {
      const orgId = orgMatch[1];

      // Only owner can delete organization
      const membership = await getMembership(userId, orgId);
      if (!membership) {
        return forbidden(res, 'You are not a member of this organization');
      }

      if (membership.role !== 'owner') {
        return forbidden(res, 'Only the owner can delete the organization');
      }

      const result = await deleteOrganization(orgId);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          return notFound(res);
        }
        if (result.reason === 'cannot_delete_default') {
          return forbidden(res, 'The default organization cannot be deleted');
        }
        return badRequest(res, 'Failed to delete organization');
      }

      serveJson(res, 200, { ok: true });
      return true;
    } catch (err) {
      log.error('[organizations] Failed to delete organization:', err);
      serveJson(res, 500, { error: 'Failed to delete organization' });
      return true;
    }
  }

  // ============================================================
  // POST /api/organizations/:id/switch - Switch active organization
  // (Sets the user's active workspace for this session)
  // ============================================================
  const switchMatch = url.pathname.match(/^\/api\/organizations\/([^/]+)\/switch$/);
  if (switchMatch && req.method === 'POST') {
    try {
      const orgId = switchMatch[1];

      // Verify membership
      const membership = await getMembership(userId, orgId);
      if (!membership) {
        return forbidden(res, 'You are not a member of this organization');
      }

      const organization = await getOrganizationById(orgId);
      if (!organization) {
        return notFound(res);
      }

      // Update the session cookie with the new organization
      updateSessionOrganization(req, res, orgId);

      // Return the organization info for the client
      serveJson(res, 200, {
        ok: true,
        organization,
        membership: {
          role: membership.role,
          joinedAt: membership.joinedAt,
        },
      });
      return true;
    } catch (err) {
      log.error('[organizations] Failed to switch organization:', err);
      serveJson(res, 500, { error: 'Failed to switch organization' });
      return true;
    }
  }

  return false;
}
