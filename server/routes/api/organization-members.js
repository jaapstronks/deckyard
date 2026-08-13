/**
 * API routes for organization member management (multi-organization mode).
 * All routes are guarded by the MULTI_ORG_ENABLED feature flag.
 */

import { serveJson, badRequest, unauthorized, forbidden, notFound, requireJsonBody, withErrorHandler } from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import { isMultiOrgEnabled } from '../../config/features.js';
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
  hasOrganizationRole,
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

/**
 * Run the guards every members path shares — the MULTI_ORG feature flag,
 * authentication, the cross-organization user-id lookup, and the actor's
 * membership in the addressed organization — exactly in the order the
 * original chain ran them, *before* the method decision (a disabled flag or a
 * non-member answers 403/401 whatever the method).
 *
 * Mounted after the auth gate in routes/api/index.js, so the user is already
 * resolved and enriched on the context — it is not re-resolved here.
 *
 * @returns {Promise<{ok: false}|{ok: true, user: object, userId: string, actorMembership: object}>}
 *   `{ok: false}` after a guard has already sent the response.
 */
async function resolveMembersActor({ res, authedUser }, organizationId) {
  // Feature flag guard - return 403 if multi-organization is not enabled
  if (!isMultiOrgEnabled()) {
    forbidden(res, 'Multi-organization features are not enabled');
    return { ok: false };
  }

  if (!authedUser) {
    unauthorized(res, 'Authentication required');
    return { ok: false };
  }

  // Get user's database record for ID. Identity is organization-independent;
  // the membership check on the next lines is what scopes this request.
  const dbUser = await getUserByEmailGlobal(authedUser.email);
  if (!dbUser) {
    unauthorized(res, 'User not found');
    return { ok: false };
  }

  // Check membership in the organization
  const actorMembership = await getMembership(dbUser.id, organizationId);
  if (!actorMembership) {
    forbidden(res, 'You are not a member of this organization');
    return { ok: false };
  }

  return { ok: true, user: authedUser, userId: dbUser.id, actorMembership };
}

// GET /api/organizations/:id/members - List members
async function handleMemberList({ res, url }, organizationId) {
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
}

// POST /api/organizations/:id/members - Invite/add a member
async function handleMemberInvite({ repoRoot, storageScope, req, res, authedUser }, organizationId, { user, userId, actorMembership }) {
  // Only admins and owners can invite members
  if (!hasOrganizationRole(actorMembership.role, 'admin')) {
    return forbidden(res, 'Admin or owner access required to invite members');
  }

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
    const createResult = await createUser(storageScope, {
      email,
      name: body?.name || null,
      role: 'user', // System-level role is always 'user'
    });

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
    const locale = await getEmailDefaultLocale(storageScope).catch(() => 'en');

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
}

// PATCH /api/organizations/:id/members/:membershipId - Update member role
async function handleMemberRoleUpdate({ req, res }, organizationId, memberIdOrUserId, { userId, actorMembership }) {
  // Only admins and owners can update roles
  if (!hasOrganizationRole(actorMembership.role, 'admin')) {
    return forbidden(res, 'Admin or owner access required');
  }

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
}

// DELETE /api/organizations/:id/members/:membershipId - Remove member
async function handleMemberRemove({ res }, organizationId, memberIdOrUserId, { userId, actorMembership }) {
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
    if (!hasOrganizationRole(actorMembership.role, 'admin')) {
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
}

// /api/organizations/:id/members - the collection path. The shared guards run
// before the method decision (route-dispatch.md, guard-before-method
// exception), then GET/POST dispatch inside; any other method falls through
// to false, exactly as the original chain did.
async function handleMembersCollection(ctx, organizationId) {
  const actor = await resolveMembersActor(ctx, organizationId);
  if (!actor.ok) return true;
  if (ctx.req.method === 'GET') return handleMemberList(ctx, organizationId);
  if (ctx.req.method === 'POST') return handleMemberInvite(ctx, organizationId, actor);
  return false;
}

// /api/organizations/:id/members/:membershipId - the item path; same
// guard-before-method shape, PATCH/DELETE inside.
async function handleMemberItem(ctx, organizationId, memberIdOrUserId) {
  const actor = await resolveMembersActor(ctx, organizationId);
  if (!actor.ok) return true;
  if (ctx.req.method === 'PATCH') return handleMemberRoleUpdate(ctx, organizationId, memberIdOrUserId, actor);
  if (ctx.req.method === 'DELETE') return handleMemberRemove(ctx, organizationId, memberIdOrUserId, actor);
  return false;
}

/**
 * Declarative route table for `/api/organizations/:id/members*` (A7.19 C8).
 * Both paths ran the module guards before the method decision, so they stay
 * single no-method handlers; a wrong method falls through to `false` (Form A)
 * after the guards, exactly as the original combined-regex chain did.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { pattern: /^\/api\/organizations\/([^/]+)\/members$/, handler: handleMembersCollection },
  { pattern: /^\/api\/organizations\/([^/]+)\/members\/([^/]+)$/, handler: handleMemberItem },
];

/**
 * Handle organization member-management routes. The prefix guard narrows to
 * the organizations tree; the members shape itself is matched by the table
 * (a non-members organizations path falls through untouched, exactly as the
 * original shape regex did).
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleOrganizationMembers = withErrorHandler('organization-members', (ctx) => {
  if (!ctx.url.pathname.startsWith('/api/organizations/')) return false;
  return dispatchRoutes(ROUTES, ctx);
});
