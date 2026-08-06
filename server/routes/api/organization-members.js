/**
 * API routes for organization member management (multi-workspace mode).
 * All routes are guarded by the MULTI_WORKSPACE_ENABLED feature flag.
 */

import { getUserFromRequestAsync } from '../../auth/auth.js';
import { serveJson, badRequest, unauthorized, forbidden, notFound, serverError, requireJsonBody } from '../../utils/http.js';
import { createRouteContext } from '../../utils/context.js';
import { isMultiWorkspaceEnabled } from '../../config/features.js';
import { normalizeEmail } from '../../utils/normalize.js';
import {
  listOrganizationMembers,
  getOrganizationMember,
  countOrganizationMembers,
  getMembership,
  getMembershipByEmail,
  addMember,
  updateMemberRole,
  updateMemberDesigner,
  removeMember,
  transferOwnership,
  hasWorkspaceRole,
  WORKSPACE_ROLES,
} from '../../storage/user-organizations/index.js';
import { createUser } from '../../storage/users.js';
import { getUserByEmailGlobal } from '../../storage/identity.js';
import { sendUserInvitationEmail } from '../../integrations/brevo.js';
import { getEmailDefaultLocale } from '../../storage/email-templates.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('organization-members');

// ============================================================
// HELPERS
// ============================================================

/**
 * Build the setup URL for a new user invitation.
 * @param {Object} req - HTTP request
 * @param {string} token - Invitation token
 * @returns {string}
 */
function buildSetupUrl(req, token) {
  const host = req.headers?.host || 'localhost:3000';
  const protocol = req.headers?.['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function handleOrganizationMembers({ repoRoot, req, res, url, authedUser }) {
  // Only handle /api/organizations/:id/members routes
  const membersMatch = url.pathname.match(/^\/api\/organizations\/([^/]+)\/members(?:\/([^/]+))?$/);
  if (!membersMatch) {
    return false;
  }

  // Feature flag guard - return 403 if multi-workspace is not enabled
  if (!isMultiWorkspaceEnabled()) {
    return forbidden(res, 'Multi-workspace features are not enabled');
  }

  const organizationId = membersMatch[1];
  const memberIdOrUserId = membersMatch[2] || null;

  const ctx = createRouteContext(authedUser);
  ctx.repoRoot = repoRoot;

  // Get the authenticated user with database info
  const user = authedUser || (await getUserFromRequestAsync(req, ctx));
  if (!user) {
    return unauthorized(res, 'Authentication required');
  }

  // Get user's database record for ID. Identity is organization-independent;
  // the membership check on the next lines is what scopes this request.
  const dbUser = await getUserByEmailGlobal(user.email);
  if (!dbUser) {
    return unauthorized(res, 'User not found');
  }

  const userId = dbUser.id;

  // Check membership in the organization
  const actorMembership = await getMembership(userId, organizationId);
  if (!actorMembership) {
    return forbidden(res, 'You are not a member of this organization');
  }

  // ============================================================
  // GET /api/organizations/:id/members - List members
  // ============================================================
  if (!memberIdOrUserId && req.method === 'GET') {
    try {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);

      const members = await listOrganizationMembers(organizationId, { limit, offset });
      const total = await countOrganizationMembers(organizationId);

      serveJson(res, 200, {
        members,
        total,
        limit,
        offset,
      });
      return true;
    } catch (err) {
      log.error('[organization-members] Failed to list members:', err);
      serverError(res, 'Failed to load members');
      return true;
    }
  }

  // ============================================================
  // POST /api/organizations/:id/members - Invite/add a member
  // ============================================================
  if (!memberIdOrUserId && req.method === 'POST') {
    // Only admins and owners can invite members
    if (!hasWorkspaceRole(actorMembership.role, 'admin')) {
      return forbidden(res, 'Admin or owner access required to invite members');
    }

    try {
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const email = normalizeEmail(body?.email);
      const role = body?.role || 'member';
      const sendInvitation = body?.sendInvitation !== false;

      if (!email || !email.includes('@')) {
        return badRequest(res, 'Valid email is required');
      }

      // Validate role - admins can only invite members, owners can invite anyone
      if (!WORKSPACE_ROLES.includes(role)) {
        return badRequest(res, 'Invalid role');
      }

      if (actorMembership.role === 'admin' && role !== 'member') {
        return forbidden(res, 'Admins can only invite members (not admins or owners)');
      }

      // Check if user is already a member
      const existingMembership = await getMembershipByEmail(email, organizationId);
      if (existingMembership) {
        return badRequest(res, 'This user is already a member of the organization');
      }

      // Check if the person already exists anywhere on the instance. Inviting
      // someone who is already a member of another organization must reuse
      // their row, not attempt a second one for a globally unique email.
      let targetUser = await getUserByEmailGlobal(email);
      let invitationToken = null;

      if (!targetUser) {
        // Create a new user (will need to set up password)
        const createResult = await createUser({
          email,
          name: body?.name || null,
          role: 'user', // System-level role is always 'user'
        }, ctx);

        if (!createResult.ok) {
          return badRequest(res, 'Failed to create user invitation');
        }

        targetUser = createResult.user;
        invitationToken = createResult.invitationToken;
      }

      // Add user to organization
      const memberResult = await addMember({
        userId: targetUser.id,
        organizationId,
        role,
        invitedBy: userId,
      });

      if (!memberResult.ok) {
        if (memberResult.reason === 'already_member') {
          return badRequest(res, 'This user is already a member');
        }
        return badRequest(res, 'Failed to add member');
      }

      // Send invitation email if this is a new user.
      //
      // Awaited, and the flag comes from the result. The inviter reads
      // `invitationSent` as "this person has a setup link in their inbox" and
      // acts on it by not following up, so it may only be true once the mail
      // actually went out. A missing Brevo key does not throw — sendEmail()
      // resolves with { ok: false } — so a fire-and-forget call with a
      // .catch() cannot see the most common failure at all, and reported a
      // mail that no instance without email configuration ever sent.
      let invitationSent = false;
      if (sendInvitation && invitationToken) {
        const setupUrl = buildSetupUrl(req, invitationToken);
        const locale = await getEmailDefaultLocale(repoRoot).catch(() => 'en');

        const sendResult = await sendUserInvitationEmail({
          recipientEmail: email,
          recipientName: body?.name || null,
          invitedBy: user.name || user.email,
          setupUrl,
          expiresAt: null, // Will be calculated by the email function
          locale,
          repoRoot,
        }).catch((err) => {
          log.error('[organization-members] Failed to send invitation email:', err);
          return { ok: false, error: String(err?.message || err) };
        });

        invitationSent = sendResult?.ok === true;
        if (!invitationSent) {
          // The membership stands either way; only the mail is missing, and
          // the response says so. Logged so an operator can tell a broken
          // email configuration from a bounced address.
          log.warn(
            '[organization-members] Invitation email not sent to %s: %s',
            email,
            sendResult?.error || 'unknown error'
          );
        }
      }

      serveJson(res, 201, {
        ok: true,
        member: {
          user: targetUser,
          role,
          isNewUser: !!invitationToken,
          invitationSent,
        },
      });
      return true;
    } catch (err) {
      log.error('[organization-members] Failed to invite member:', err);
      serverError(res, 'Failed to invite member');
      return true;
    }
  }

  // ============================================================
  // PATCH /api/organizations/:id/members/:membershipId - Update member role
  // ============================================================
  if (memberIdOrUserId && req.method === 'PATCH') {
    // Only admins and owners can update roles
    if (!hasWorkspaceRole(actorMembership.role, 'admin')) {
      return forbidden(res, 'Admin or owner access required');
    }

    try {
      const parsed = await requireJsonBody(req, res);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const newRole = body?.role;

      if (!newRole || !WORKSPACE_ROLES.includes(newRole)) {
        return badRequest(res, 'Valid role is required (member, admin, or owner)');
      }

      // Get the target membership. `memberIdOrUserId` can be either a
      // membership ID or a user ID, and the lookup accepts both.
      const targetMembership = await getOrganizationMember(organizationId, memberIdOrUserId);

      if (!targetMembership) {
        return notFound(res);
      }

      // Check permissions
      // - Admins can only change members to/from member role
      // - Owners can change anyone
      // - Can't change own role (except for owner transfer)
      if (targetMembership.user.id === userId && newRole !== 'owner') {
        return badRequest(res, 'You cannot change your own role');
      }

      if (actorMembership.role === 'admin') {
        // Both halves of the guard used to hinge on `newRole !== 'member'`, so
        // the branch the comment describes — an admin reaching for another
        // admin or the owner — went through as long as the *new* role was
        // `member`. An organization admin could demote the owner and leave the
        // organization ownerless. The target's current role is what decides
        // whether an admin may touch this membership at all.
        if (targetMembership.role !== 'member') {
          return forbidden(res, 'Admins cannot modify other admins or owners');
        }
        if (newRole !== 'member') {
          return forbidden(res, 'Admins can only set role to member');
        }
      }

      // Handle owner transfer separately
      if (newRole === 'owner') {
        if (actorMembership.role !== 'owner') {
          return forbidden(res, 'Only the current owner can transfer ownership');
        }

        const transferResult = await transferOwnership(
          organizationId,
          userId,
          targetMembership.user.id
        );

        if (!transferResult.ok) {
          return badRequest(res, 'Failed to transfer ownership');
        }

        serveJson(res, 200, { ok: true, transferred: true });
        return true;
      }

      // Regular role update
      const result = await updateMemberRole(targetMembership.membershipId, newRole);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          return notFound(res);
        }
        if (result.reason === 'last_owner') {
          return badRequest(res, 'Transfer ownership before changing the owner’s role');
        }
        return badRequest(res, 'Failed to update role');
      }

      // Update designer flag if provided
      if ('isDesigner' in body) {
        await updateMemberDesigner(targetMembership.membershipId, Boolean(body.isDesigner));
      }

      serveJson(res, 200, { ok: true, membership: result.membership });
      return true;
    } catch (err) {
      log.error('[organization-members] Failed to update member role:', err);
      serverError(res, 'Failed to update member role');
      return true;
    }
  }

  // ============================================================
  // DELETE /api/organizations/:id/members/:membershipId - Remove member
  // ============================================================
  if (memberIdOrUserId && req.method === 'DELETE') {
    try {
      // Get the target membership (membership ID or user ID, either works).
      const targetMembership = await getOrganizationMember(organizationId, memberIdOrUserId);

      if (!targetMembership) {
        return notFound(res);
      }

      const isSelfRemoval = targetMembership.user.id === userId;

      // Permission checks
      if (isSelfRemoval) {
        // Users can remove themselves (leave organization)
        // But owners cannot leave without transferring ownership first
        if (targetMembership.role === 'owner') {
          return badRequest(res, 'Owner must transfer ownership before leaving');
        }
      } else {
        // Only admins and owners can remove others
        if (!hasWorkspaceRole(actorMembership.role, 'admin')) {
          return forbidden(res, 'Admin or owner access required to remove members');
        }

        // Admins cannot remove admins or owners
        if (actorMembership.role === 'admin' && targetMembership.role !== 'member') {
          return forbidden(res, 'Admins cannot remove other admins or owners');
        }

        // Cannot remove the owner
        if (targetMembership.role === 'owner') {
          return forbidden(res, 'Cannot remove the organization owner');
        }
      }

      const result = await removeMember(targetMembership.membershipId);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          return notFound(res);
        }
        if (result.reason === 'last_owner') {
          return badRequest(res, 'Cannot remove the last owner');
        }
        return badRequest(res, 'Failed to remove member');
      }

      serveJson(res, 200, { ok: true });
      return true;
    } catch (err) {
      log.error('[organization-members] Failed to remove member:', err);
      serverError(res, 'Failed to remove member');
      return true;
    }
  }

  return false;
}
