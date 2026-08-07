/**
 * What the signed-in person may do to a member row (organization UI, slice 4).
 *
 * These are a mirror of the checks in
 * `server/routes/api/organization-members.js`, not a second source of truth:
 * the server decides, and every action handles its refusal. What they buy is
 * that a button which is certain to be refused is never drawn — the briefing's
 * "an affordance that 403s is worse than none", now applied per row instead of
 * per screen.
 *
 * The mirror can still be wrong at the moment of the click: the role in the
 * session is a snapshot, and someone else may be demoting you while you look
 * at the list. That is exactly why the actions treat a 403 as an ordinary
 * outcome rather than a surprise.
 *
 * Identity is matched on email, because `/api/auth/me` does not carry a user
 * id and email is globally unique on an instance.
 */

import { hasOrganizationRole, getOrganizationRole } from '../../../lib/user/organization-role.js';

/**
 * Whether a member row is the signed-in person.
 * @param {Object} member - Member from `GET /api/organizations/:id/members`
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function isSelf(member, currentUser) {
  const email = currentUser?.email;
  return Boolean(email && member?.user?.email === email);
}

/**
 * Whether the viewer may bring someone new into the organization.
 *
 * Admin or owner, mirroring the route's own guard. A plain member sees the
 * list without the button rather than a button that 403s.
 *
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function canInvite(currentUser) {
  return hasOrganizationRole(getOrganizationRole(currentUser), 'admin');
}

/**
 * Which roles the viewer may hand out in an invitation.
 *
 * The server caps an admin at `member` ("Admins can only invite members"), so
 * offering them a choice would be offering a refusal. An owner picks between
 * member and admin; `owner` is not on the list because handing the
 * organization to someone who is not in it yet is the transfer path, not the
 * invite path.
 *
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {Array<string>} Roles, weakest first; empty when the viewer may not invite.
 */
export function invitableRoles(currentUser) {
  if (!canInvite(currentUser)) return [];
  return getOrganizationRole(currentUser) === 'owner' ? ['member', 'admin'] : ['member'];
}

/**
 * Whether the viewer may change this member's role between member and admin.
 *
 * Owners only. An admin's role writes are capped at "set to member" *and*
 * "target is already a member" on the server, which is the empty set, so an
 * admin gets no role control rather than one that only ever no-ops.
 *
 * @param {Object} member - Target member
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function canChangeRole(member, currentUser) {
  if (getOrganizationRole(currentUser) !== 'owner') return false;
  if (isSelf(member, currentUser)) return false;
  // The owner is the viewer in this branch; a second owner would be a state the
  // transfer path does not produce, and demoting one is the server's refusal.
  return member?.role !== 'owner';
}

/**
 * Whether the viewer may hand the organization to this member.
 * @param {Object} member - Target member
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function canTransferOwnership(member, currentUser) {
  if (getOrganizationRole(currentUser) !== 'owner') return false;
  return !isSelf(member, currentUser) && member?.role !== 'owner';
}

/**
 * Whether the viewer may remove this member from the organization.
 *
 * Removing yourself is leaving, and everyone may leave except the owner, who
 * has to hand the organization over first. Removing someone else needs admin
 * or owner, and an admin may only remove plain members.
 *
 * @param {Object} member - Target member
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function canRemove(member, currentUser) {
  const role = getOrganizationRole(currentUser);
  if (!role) return false;

  if (isSelf(member, currentUser)) return member?.role !== 'owner';

  if (!hasOrganizationRole(role, 'admin')) return false;
  if (member?.role === 'owner') return false;
  if (role === 'admin' && member?.role !== 'member') return false;
  return true;
}

/**
 * Whether the viewer is the owner and therefore stuck in the organization
 * until they hand it over. Drives the explanation shown in place of a Leave
 * button, so the absence reads as a rule rather than as a missing feature.
 *
 * @param {Object} member - Target member
 * @param {Object} [currentUser] - User from `/api/auth/me`
 * @returns {boolean}
 */
export function isOwnerBlockedFromLeaving(member, currentUser) {
  return isSelf(member, currentUser) && member?.role === 'owner';
}
