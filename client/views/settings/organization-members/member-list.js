/**
 * Organization member list rendering (organization UI, slice 3).
 *
 * Read-only on purpose: this slice moves the Users tab off the instance-wide
 * user list and onto the members of the *active* organization. The actions
 * (role change, remove, leave, transfer ownership) arrive in slice 4, so a card
 * here carries no buttons — an affordance that 403s is worse than none.
 *
 * Reuses the `.admin-user-*` classes rather than minting a parallel set: this
 * is the same tab, showing the same kind of row, in a different mode.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Human label for a membership role.
 * @param {string} role - Membership role (`owner` / `admin` / `member`)
 * @returns {string}
 */
function roleLabel(role) {
  if (role === 'owner') return t('organization.members.roleOwner', 'Owner');
  if (role === 'admin') return t('organization.members.roleAdmin', 'Admin');
  return t('organization.members.roleMember', 'Member');
}

/**
 * Render a single member card.
 * @param {Object} member - Member from `GET /api/organizations/:id/members`
 * @param {Object} currentUser - Current logged-in user
 * @returns {HTMLElement}
 */
function renderMemberCard(member, currentUser) {
  const person = member?.user || {};
  const card = h('div', { class: 'admin-user-card' });
  const mainRow = h('div', { class: 'admin-user-main' });
  const info = h('div', { class: 'admin-user-info' });

  const emailRow = h('div', { class: 'admin-user-email-row' });
  emailRow.append(h('span', { class: 'admin-user-email', text: person.email || '' }));

  // Owner and admin share the elevated badge treatment; the label is what
  // separates them.
  emailRow.append(
    h('span', {
      class: `admin-user-role-badge ${member.role === 'member' ? '' : 'is-admin'}`,
      text: roleLabel(member.role),
    })
  );

  // The explicit `is_designer` flag only. Owners, and admins on an organization
  // that leaves `adminsAreDesigners` on, hold the capability through their role
  // instead — badging them here would read as a flag that is not set.
  if (member.isDesigner) {
    emailRow.append(
      h('span', {
        class: 'admin-user-role-badge is-designer',
        text: t('organization.members.roleDesigner', 'Designer'),
      })
    );
  }

  if (currentUser?.email && person.email === currentUser.email) {
    emailRow.append(
      h('span', {
        class: 'admin-user-role-badge',
        text: t('organization.members.you', 'You'),
      })
    );
  }

  info.append(emailRow);

  if (person.name) {
    info.append(h('div', { class: 'admin-user-name', text: person.name }));
  }

  info.append(
    h('div', {
      class: 'admin-user-last-login',
      text: member.joinedAt
        ? t('organization.members.memberSince', 'Member since {date}', {
            date: new Date(member.joinedAt).toLocaleDateString(),
          })
        : t('organization.members.memberSinceUnknown', 'Membership date unknown'),
    })
  );

  mainRow.append(info);
  card.append(mainRow);
  return card;
}

/**
 * Render the member list into a container.
 * @param {HTMLElement} container - Container element (cleared first)
 * @param {Array<Object>} members - Members to render
 * @param {Object} currentUser - Current logged-in user
 * @param {number} [total] - Total members in the organization
 */
export function renderMembersList(container, members, currentUser, total) {
  container.innerHTML = '';

  if (!members.length) {
    container.append(
      h('div', {
        class: 'help',
        text: t('organization.members.empty', 'No members found.'),
      })
    );
    return;
  }

  const list = h('div', { class: 'admin-users-grid' });
  for (const member of members) {
    list.append(renderMemberCard(member, currentUser));
  }
  container.append(list);

  // Say it out loud when the page does not hold the whole organization, rather
  // than letting a truncated list read as a complete one. Paging comes with the
  // management actions in slice 4.
  if (Number.isFinite(total) && total > members.length) {
    container.append(
      h('div', {
        class: 'help',
        text: t('organization.members.truncated', 'Showing {shown} of {total} members.', {
          shown: members.length,
          total,
        }),
      })
    );
  }
}
