/**
 * Admin API routes for user management.
 * Allows admins to list, create, update, and delete users.
 */

import { serveJson, badRequest, unauthorized, notFound, serverError, rateLimited, requireJsonBody } from '../../utils/http.js';
import { getTrimmedString } from '../../utils/request-validators.js';
import { getClientIp, getOrgId } from '../../utils/context.js';
import { dispatchRoutes } from '../../utils/router.js';
import { sendUserInvitationEmail, sendActivationReminderEmail } from '../../integrations/brevo.js';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  resendInvitation,
} from '../../storage/users.js';
import { logAuthEvent } from '../../storage/password-reset.js';
import { getEmailDefaultLocale } from '../../storage/email-templates.js';
import { normalizeEmail } from '../../utils/normalize.js';
import {
  getMembershipByEmail,
  updateMemberDesigner,
  hasDesignerCapability,
  addMember,
} from '../../storage/user-organizations/index.js';
import { getOrganizationById } from '../../storage/user-organizations/index.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('admin-users');

// ============================================================
// RATE LIMITING
// In-memory rate limiting for admin user operations
// ============================================================

const RATE_LIMIT_CREATE_PER_ADMIN = 20; // per hour
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Map of adminEmail -> { count, resetAt }
const createRateLimits = new Map();

/**
 * Check and update rate limit for an admin.
 * @param {string} adminEmail - Admin's email address
 * @param {number} maxRequests - Maximum requests per window
 * @returns {boolean} - True if rate limited
 */
function checkAdminRateLimit(adminEmail, maxRequests) {
  const now = Date.now();
  const entry = createRateLimits.get(adminEmail);

  // Clean up expired entries periodically
  if (createRateLimits.size > 1000) {
    for (const [key, val] of createRateLimits) {
      if (val.resetAt < now) createRateLimits.delete(key);
    }
  }

  if (!entry || entry.resetAt < now) {
    // New window
    createRateLimits.set(adminEmail, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= maxRequests) {
    return true;
  }

  entry.count++;
  return false;
}

/**
 * Build the setup URL for a new user invitation.
 * @param {Object} req - HTTP request
 * @param {string} token - Invitation token
 * @returns {string} - Full setup URL
 */
function buildSetupUrl(req, token) {
  const host = req.headers?.host || 'localhost:3000';
  const protocol = req.headers?.['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/reset-password?token=${encodeURIComponent(token)}`;
}

// GET /api/admin/users - List all users
async function handleAdminUserList({ storageScope: ctx, res }) {
  try {
    const users = await listUsers(ctx);

    // Enrich users with designer status from their org membership
    const orgId = getOrgId(ctx);
    const org = await getOrganizationById(orgId).catch(() => null);
    const orgSettings = org?.settings && typeof org.settings === 'object' ? org.settings : {};

    const enrichedUsers = await Promise.all(users.map(async (u) => {
      try {
        const membership = await getMembershipByEmail(u.email, orgId);
        const isDesigner = membership ? hasDesignerCapability(membership, orgSettings) : false;
        const isExplicitDesigner = membership ? membership.isDesigner : false;
        return { ...u, isDesigner, isExplicitDesigner };
      } catch {
        return { ...u, isDesigner: false, isExplicitDesigner: false };
      }
    }));

    serveJson(res, 200, { users: enrichedUsers });
    return true;
  } catch (err) {
    log.error('[admin-users] Failed to list users:', err);
    serverError(res, 'Failed to load users');
    return true;
  }
}

// POST /api/admin/users - Create a new user
async function handleAdminUserCreate({ repoRoot, storageScope: ctx, req, res, authedUser: user }) {
  // Rate limit user creation to prevent abuse
  if (checkAdminRateLimit(user.email, RATE_LIMIT_CREATE_PER_ADMIN)) {
    rateLimited(res, 3600, 'Too many user creation requests. Please try again later.');
    return true;
  }

  try {
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    const email = normalizeEmail(body?.email);
    const name = getTrimmedString(body, 'name');
    const role = body?.role === 'admin' ? 'admin' : 'user';
    const sendInvitation = body?.sendInvitation !== false; // Default to true

    if (!email || !email.includes('@')) {
      return badRequest(res, 'Valid email is required');
    }

    const result = await createUser({ email, name, role }, ctx);

    if (!result.ok) {
      if (result.reason === 'already_exists') {
        return badRequest(res, 'A user with this email already exists');
      }
      return badRequest(res, 'Failed to create user');
    }

    // Log the event
    await logAuthEvent({
      type: 'user_created',
      email,
      success: true,
      ipAddress: getClientIp(req),
      userAgent: req.headers?.['user-agent'] || '',
      metadata: { createdBy: user.email, role },
    });

    // Send invitation email if requested. Awaited, and the flag follows the
    // result: sendEmail() reports a missing Brevo key by resolving with
    // { ok: false } rather than throwing, so reporting the *request* to send
    // promised a mail that an instance without email configuration never
    // sent. See the same correction in routes/api/organization-members.js.
    let invitationSent = false;
    if (sendInvitation && result.invitationToken) {
      const setupUrl = buildSetupUrl(req, result.invitationToken);

      // Get default locale for invitations
      const locale = await getEmailDefaultLocale(repoRoot).catch(() => 'en');

      const sendResult = await sendUserInvitationEmail({
        recipientEmail: email,
        recipientName: name,
        invitedBy: user.name || user.email,
        setupUrl,
        expiresAt: result.invitationExpiresAt,
        locale,
        repoRoot,
      }).catch((err) => {
        log.error('[admin-users] Failed to send invitation email:', err);
        return { ok: false, error: String(err?.message || err) };
      });

      invitationSent = sendResult?.ok === true;
      if (!invitationSent) {
        log.warn(
          '[admin-users] Invitation email not sent to %s: %s',
          email,
          sendResult?.error || 'unknown error'
        );
      }
    }

    serveJson(res, 201, {
      ok: true,
      user: result.user,
      invitationSent,
    });
    return true;
  } catch (err) {
    log.error('[admin-users] Failed to create user:', err);
    serverError(res, 'Failed to create user');
    return true;
  }
}

// GET /api/admin/users/:id - Get a specific user
async function handleAdminUserGet({ storageScope: ctx, res }, userId) {
  try {
    const targetUser = await getUserById(userId, ctx);

    if (!targetUser) {
      return notFound(res);
    }

    serveJson(res, 200, { user: targetUser });
    return true;
  } catch (err) {
    log.error('[admin-users] Failed to get user:', err);
    serverError(res, 'Failed to load user');
    return true;
  }
}

// PATCH /api/admin/users/:id - Update a user
async function handleAdminUserUpdate({ storageScope: ctx, req, res }, userId) {
  try {
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;

    const updates = {};
    if ('name' in body) updates.name = getTrimmedString(body, 'name');
    if ('role' in body) updates.role = body.role;

    const hasDesignerUpdate = 'isDesigner' in body;
    const hasUserUpdates = Object.keys(updates).length > 0;

    if (!hasUserUpdates && !hasDesignerUpdate) {
      return badRequest(res, 'No valid updates provided');
    }

    let resultUser = null;

    // Update user fields (name, role) if provided
    if (hasUserUpdates) {
      const result = await updateUser(userId, updates, ctx);
      if (!result.ok) {
        if (result.reason === 'not_found') {
          return notFound(res);
        }
        return badRequest(res, 'Failed to update user');
      }
      resultUser = result.user;
    }

    // Update designer flag on the user's org membership
    if (hasDesignerUpdate) {
      const targetUser = resultUser || await getUserById(userId, ctx);
      if (!targetUser) {
        return notFound(res);
      }

      const orgId = getOrgId(ctx);
      let membership = await getMembershipByEmail(targetUser.email, orgId);

      // Auto-create membership if user doesn't have one yet
      if (!membership && targetUser.id) {
        await addMember({
          userId: targetUser.id,
          organizationId: orgId,
          role: targetUser.role === 'admin' ? 'admin' : 'member',
        });
        membership = await getMembershipByEmail(targetUser.email, orgId);
      }

      if (membership) {
        await updateMemberDesigner(membership.id, Boolean(body.isDesigner));
      }

      resultUser = resultUser || targetUser;
    }

    serveJson(res, 200, { ok: true, user: resultUser });
    return true;
  } catch (err) {
    log.error('[admin-users] Failed to update user:', err);
    serverError(res, 'Failed to update user');
    return true;
  }
}

// DELETE /api/admin/users/:id - Delete a user
async function handleAdminUserDelete({ storageScope: ctx, req, res, authedUser: user }, userId) {
  try {
    // Prevent self-deletion
    const targetUser = await getUserById(userId, ctx);
    if (targetUser?.email === user.email) {
      return badRequest(res, 'You cannot delete your own account');
    }

    const result = await deleteUser(userId, ctx);

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return notFound(res);
      }
      return badRequest(res, 'Failed to delete user');
    }

    // Log the event
    await logAuthEvent({
      type: 'user_deleted',
      email: targetUser?.email,
      success: true,
      ipAddress: getClientIp(req),
      userAgent: req.headers?.['user-agent'] || '',
      metadata: { deletedBy: user.email },
    });

    serveJson(res, 200, { ok: true });
    return true;
  } catch (err) {
    log.error('[admin-users] Failed to delete user:', err);
    serverError(res, 'Failed to delete user');
    return true;
  }
}

// POST /api/admin/users/:id/resend-invitation - Resend invitation
async function handleAdminUserResendInvitation({ repoRoot, storageScope: ctx, req, res, authedUser: user }, userId) {
  try {
    const result = await resendInvitation(userId, ctx);

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return notFound(res);
      }
      if (result.reason === 'already_activated') {
        return badRequest(res, 'This user has already set up their account');
      }
      return badRequest(res, 'Failed to resend invitation');
    }

    const targetUser = await getUserById(userId, ctx);
    let invitationSent = false;
    if (targetUser && result.invitationToken) {
      const setupUrl = buildSetupUrl(req, result.invitationToken);

      // Get default locale for invitations
      const locale = await getEmailDefaultLocale(repoRoot).catch(() => 'en');

      // Use activation reminder template since this is a resend
      const sendResult = await sendActivationReminderEmail({
        recipientEmail: targetUser.email,
        recipientName: targetUser.name,
        invitedBy: user.name || user.email,
        setupUrl,
        locale,
        repoRoot,
      }).catch((err) => {
        log.error('[admin-users] Failed to send activation reminder email:', err);
        return { ok: false, error: String(err?.message || err) };
      });

      invitationSent = sendResult?.ok === true;
      if (!invitationSent) {
        log.warn(
          '[admin-users] Activation reminder not sent to %s: %s',
          targetUser.email,
          sendResult?.error || 'unknown error'
        );
      }
    }

    // The token was rotated whatever happened to the mail, so this is a
    // success with a caveat rather than a failure — the caller decides what
    // to say about it. "Resent" without the caveat is what sent an admin
    // away believing a link was on its way.
    serveJson(res, 200, { ok: true, invitationSent });
    return true;
  } catch (err) {
    log.error('[admin-users] Failed to resend invitation:', err);
    serverError(res, 'Failed to resend invitation');
    return true;
  }
}

/**
 * Declarative route table for `/api/admin/users*` (A7.19 C8). Order matches
 * the previous if-chain; every path fell through on a method mismatch (Form A),
 * so there are no 405 catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/admin/users', handler: handleAdminUserList },
  { method: 'POST', pattern: '/api/admin/users', handler: handleAdminUserCreate },
  { method: 'GET', pattern: /^\/api\/admin\/users\/([^/]+)$/, handler: handleAdminUserGet },
  { method: 'PATCH', pattern: /^\/api\/admin\/users\/([^/]+)$/, handler: handleAdminUserUpdate },
  { method: 'DELETE', pattern: /^\/api\/admin\/users\/([^/]+)$/, handler: handleAdminUserDelete },
  { method: 'POST', pattern: /^\/api\/admin\/users\/([^/]+)\/resend-invitation$/, handler: handleAdminUserResendInvitation },
];

/**
 * Handle admin user-management routes. The module-wide guards (path prefix,
 * authentication, admin role) run before dispatch, exactly as the original
 * chain did.
 *
 * Mounted after the auth gate in routes/api/index.js, so the user is already
 * resolved and enriched on the context — it is not re-resolved here. The admin
 * check is the instance-wide flag on purpose: these routes create and delete
 * accounts on the instance, which is not a per-organization power. Which
 * organization those accounts belong to *is* per-organization, so handlers act
 * under `storageScope` — built once, from the enriched session user, in
 * index.js.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleAdminUsers(ctx) {
  // Only handle /api/admin/users routes
  if (!ctx.url.pathname.startsWith('/api/admin/users')) {
    return false;
  }

  if (!ctx.authedUser) {
    return unauthorized(ctx.res, 'Authentication required');
  }

  if (!ctx.authedUser.isAdmin) {
    return unauthorized(ctx.res, 'Admin access required');
  }

  return dispatchRoutes(ROUTES, ctx);
}
