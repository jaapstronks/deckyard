/**
 * API routes for organization management (multi-organization mode).
 * All routes are guarded by the MULTI_ORG_ENABLED feature flag.
 */

import { updateSessionOrganization } from '../../auth/auth.js';
import {
  badRequest,
  forbidden,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  unauthorized,
  withErrorHandler,
} from '../../utils/http.js';
import { getTrimmedString } from '../../utils/request-validators.js';
import { dispatchRoutes } from '../../utils/router.js';
import { isMultiOrgEnabled } from '../../config/features.js';
import {
  listUserOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getMembership,
  hasOrganizationRole,
  isDefaultOrganization,
} from '../../storage/user-organizations/index.js';
import { getUserByEmailGlobal } from '../../storage/identity.js';

/**
 * Human-readable text per organization-mutation failure reason.
 *
 * Status comes from the reason's `REASONS` entry (`server/storage/reasons.js`),
 * not from here — the ladders this replaced ended in
 * `badRequest(res, 'Failed to …')`, so a database outage answered 400.
 */
const ORGANIZATION_FAILURE_MESSAGES = {
  slug_exists: 'An organization with this slug already exists',
  cannot_delete_default: 'The default organization cannot be deleted',
};

/**
 * Answer a failed organization mutation in the canonical envelope.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{reason: string, field?: string}} result
 * @returns {true}
 */
function organizationError(res, result) {
  return storageError(
    res,
    result,
    ORGANIZATION_FAILURE_MESSAGES[result.reason],
  );
}

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

// GET /api/organizations - List user's organizations
async function handleOrgList({ res, userId }) {
  const organizations = await listUserOrganizations(userId);
  serveJson(res, 200, { organizations });
  return true;
}

// POST /api/organizations - Create a new organization
async function handleOrgCreate({ req, res, userId }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const name = getTrimmedString(body, 'name') || '';
  const slug = (getTrimmedString(body, 'slug') || '').toLowerCase();
  const displayName = body?.displayName
    ? String(body.displayName).trim()
    : null;
  const description = body?.description
    ? String(body.description).trim()
    : null;

  if (!name || name.length < 2) {
    return badRequest(res, 'Organization name must be at least 2 characters');
  }

  if (!isValidSlug(slug)) {
    return badRequest(
      res,
      'Slug must be 2-63 characters, lowercase alphanumeric with optional hyphens',
    );
  }

  const result = await createOrganization({
    name,
    slug,
    displayName,
    description,
    ownerId: userId,
  });

  if (!result.ok) {
    return organizationError(res, result);
  }

  serveJson(res, 201, {
    ok: true,
    organization: result.organization,
  });
  return true;
}

// GET /api/organizations/:id - Get organization details
async function handleOrgGet({ res, userId }, orgId) {
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
    // `isDefault` is the one rule about this organization that DELETE
    // enforces and nothing else on the wire reveals: the default organization
    // is what every single-organization path falls back to and may not be
    // removed. Without it the profile screen can only offer its owner a
    // Delete button that is certain to be refused.
    organization: {
      ...organization,
      isDefault: isDefaultOrganization(organization.id),
    },
    membership: {
      role: membership.role,
      joinedAt: membership.joinedAt,
    },
  });
  return true;
}

// PATCH /api/organizations/:id - Update organization
async function handleOrgUpdate({ req, res, userId }, orgId) {
  // Check membership and admin permission
  const membership = await getMembership(userId, orgId);
  if (!membership) {
    return forbidden(res, 'You are not a member of this organization');
  }

  if (!hasOrganizationRole(membership.role, 'admin')) {
    return forbidden(res, 'Admin or owner access required');
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const updates = {};

  if ('name' in body) {
    const name = getTrimmedString(body, 'name') || '';
    if (name.length < 2) {
      return badRequest(res, 'Organization name must be at least 2 characters');
    }
    updates.name = name;
  }

  if ('displayName' in body) {
    updates.displayName = body.displayName
      ? String(body.displayName).trim()
      : null;
  }

  if ('description' in body) {
    updates.description = body.description
      ? String(body.description).trim()
      : null;
  }

  if ('logoUrl' in body) {
    updates.logoUrl = body.logoUrl ? String(body.logoUrl).trim() : null;
  }

  if (Object.keys(updates).length === 0) {
    return badRequest(res, 'No valid updates provided');
  }

  const result = await updateOrganization(orgId, updates);

  if (!result.ok) {
    return organizationError(res, result);
  }

  serveJson(res, 200, { ok: true, organization: result.organization });
  return true;
}

// DELETE /api/organizations/:id - Delete organization
async function handleOrgDelete({ res, userId }, orgId) {
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
    return organizationError(res, result);
  }

  serveJson(res, 200, { ok: true });
  return true;
}

// POST /api/organizations/:id/switch - Switch active organization
// (Sets the user's active organization for this session)
async function handleOrgSwitch({ req, res, userId }, orgId) {
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
}

/**
 * Declarative route table for `/api/organizations*` (A7.19 C8). Order matches
 * the previous if-chain; every path fell through on a method mismatch (Form A),
 * so there are no 405 catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/organizations', handler: handleOrgList },
  { method: 'POST', pattern: '/api/organizations', handler: handleOrgCreate },
  {
    method: 'GET',
    pattern: /^\/api\/organizations\/([^/]+)$/,
    handler: handleOrgGet,
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/organizations\/([^/]+)$/,
    handler: handleOrgUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/organizations\/([^/]+)$/,
    handler: handleOrgDelete,
  },
  {
    method: 'POST',
    pattern: /^\/api\/organizations\/([^/]+)\/switch$/,
    handler: handleOrgSwitch,
  },
];

/**
 * Handle organization API routes. The module-wide guards (path prefix, the
 * MULTI_ORG feature flag, authentication, and the cross-organization user-id
 * lookup) run before dispatch, exactly as the original chain did. Handlers
 * receive the context extended with `userId`.
 *
 * Mounted after the auth gate in routes/api/index.js, so the user is already
 * resolved and enriched on the context — it is not re-resolved here.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleOrganizations = withErrorHandler(
  'organizations',
  async (ctx) => {
    // Only handle /api/organizations routes
    if (!ctx.url.pathname.startsWith('/api/organizations')) {
      return false;
    }

    // Feature flag guard - return 403 if multi-organization is not enabled
    if (!isMultiOrgEnabled()) {
      return forbidden(ctx.res, 'Multi-organization features are not enabled');
    }

    if (!ctx.authedUser) {
      return unauthorized(ctx.res, 'Authentication required');
    }

    // Get user's database record for ID. Resolved across organizations: this is
    // the lookup that decides which organizations the person may switch to, so
    // scoping it to the current one would make switching impossible for anyone
    // whose home organization is not the one they are currently in.
    const dbUser = await getUserByEmailGlobal(ctx.authedUser.email);
    if (!dbUser) {
      return unauthorized(ctx.res, 'User not found');
    }

    return dispatchRoutes(ROUTES, { ...ctx, userId: dbUser.id });
  },
);
