/**
 * Admin user list rendering.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { confirmDelete, resendInvitation } from './actions.js';

/**
 * Render a single user card.
 * @param {Object} u - User object
 * @param {Object} currentUser - Current logged-in user
 * @param {Function} onEdit - Callback when edit is clicked
 * @param {Function} onRefresh - Callback to refresh the list
 * @returns {HTMLElement}
 */
function renderUserCard(u, currentUser, onEdit, onRefresh) {
  const card = h('div', { class: 'admin-user-card' });

  // Main row: info + actions
  const mainRow = h('div', { class: 'admin-user-main' });

  // Left side: user info
  const userInfo = h('div', { class: 'admin-user-info' });

  // Email with role badge
  const emailRow = h('div', { class: 'admin-user-email-row' });
  const emailText = h('span', { class: 'admin-user-email', text: u.email });
  const roleBadge = h('span', {
    class: `admin-user-role-badge ${u.role === 'admin' ? 'is-admin' : ''}`,
    text: u.role === 'admin' ? t('admin.users.roleAdmin', 'Admin') : t('admin.users.roleUser', 'User'),
  });
  emailRow.append(emailText, roleBadge);

  // Designer badge (only for explicit designers - admins/owners get it implicitly)
  if (u.isExplicitDesigner) {
    const designerBadge = h('span', {
      class: 'admin-user-role-badge is-designer',
      text: t('admin.users.roleDesigner', 'Designer'),
    });
    emailRow.append(designerBadge);
  }

  // Name (if set)
  const nameText = u.name
    ? h('div', { class: 'admin-user-name', text: u.name })
    : null;

  userInfo.append(emailRow);
  if (nameText) userInfo.append(nameText);

  // Status indicators (labeled dots)
  const statusRow = h('div', { class: 'admin-user-status' });

  // Password indicator
  const pwIndicator = h('span', {
    class: 'admin-user-status-item',
    title: u.hasPassword
      ? t('admin.users.status.passwordSet', 'Password set')
      : t('admin.users.status.noPassword', 'No password set'),
  });
  const pwDot = h('span', {
    class: `admin-user-dot ${u.hasPassword ? 'is-success' : 'is-muted'}`,
  });
  const pwLabel = h('span', {
    class: 'admin-user-status-label',
    text: t('admin.users.status.passwordLabel', 'Password'),
  });
  pwIndicator.append(pwDot, pwLabel);

  // Login indicator
  const hasLoggedIn = Boolean(u.lastLoginAt);
  const loginIndicator = h('span', {
    class: 'admin-user-status-item',
    title: hasLoggedIn
      ? t('admin.users.status.loggedIn', 'Has logged in') + `: ${new Date(u.lastLoginAt).toLocaleDateString()}`
      : t('admin.users.status.neverLoggedIn', 'Never logged in'),
  });
  const loginDot = h('span', {
    class: `admin-user-dot ${hasLoggedIn ? 'is-success' : 'is-muted'}`,
  });
  const loginLabel = h('span', {
    class: 'admin-user-status-label',
    text: t('admin.users.status.loginLabel', 'Logged in'),
  });
  loginIndicator.append(loginDot, loginLabel);

  statusRow.append(pwIndicator, loginIndicator);

  // Invitation warning (if applicable)
  if (!u.hasPassword && u.invitationStatus) {
    const isExpired = u.invitationStatus === 'expired';
    const inviteIndicator = h('span', {
      class: 'admin-user-status-item',
      title: isExpired
        ? t('admin.users.status.invitationExpired', 'Invitation expired - resend required')
        : t('admin.users.status.invitationPending', 'Awaiting activation'),
    });
    const inviteDot = h('span', {
      class: `admin-user-dot ${isExpired ? 'is-danger' : 'is-warning'}`,
    });
    const inviteLabel = h('span', {
      class: 'admin-user-status-label',
      text: isExpired
        ? t('admin.users.status.inviteExpiredLabel', 'Invite expired')
        : t('admin.users.status.invitePendingLabel', 'Invite sent'),
    });
    inviteIndicator.append(inviteDot, inviteLabel);
    statusRow.append(inviteIndicator);
  }

  userInfo.append(statusRow);

  // Last login timestamp
  const lastLoginText = h('div', {
    class: 'admin-user-last-login',
    text: hasLoggedIn
      ? t('admin.users.lastLogin', 'Last login') + ': ' + new Date(u.lastLoginAt).toLocaleString()
      : t('admin.users.neverLoggedIn', 'Never logged in'),
  });
  userInfo.append(lastLoginText);

  // Right side: actions
  const actionsWrap = h('div', { class: 'admin-user-actions' });

  // Primary action: Edit button
  const editBtn = h('button', {
    class: 'btn btn-sm btn-ghost',
    type: 'button',
    title: t('admin.users.edit', 'Edit'),
  });
  editBtn.append(h('span', { text: t('admin.users.edit', 'Edit') }));
  editBtn.onclick = () => onEdit(u);
  actionsWrap.append(editBtn);

  // Resend invitation (if applicable) - show as text link
  if (!u.hasPassword) {
    const resendBtn = h('button', {
      class: 'btn btn-sm btn-ghost admin-user-resend',
      type: 'button',
      title: t('admin.users.resendInvitation', 'Resend invitation'),
    });
    resendBtn.append(h('span', { text: t('admin.users.resendInvitation', 'Resend') }));
    resendBtn.onclick = () => resendInvitation(u, resendBtn);
    actionsWrap.append(resendBtn);
  }

  // Delete button (don't allow self-deletion)
  if (u.email !== currentUser.email) {
    const deleteBtn = h('button', {
      class: 'btn btn-sm btn-ghost btn-danger admin-user-delete',
      type: 'button',
      title: t('admin.users.delete', 'Delete'),
    });
    deleteBtn.append(h('span', { text: t('admin.users.delete', 'Delete') }));
    deleteBtn.onclick = () => confirmDelete(u, onRefresh);
    actionsWrap.append(deleteBtn);
  }

  mainRow.append(userInfo, actionsWrap);
  card.append(mainRow);

  return card;
}

/**
 * Render the users list.
 * @param {HTMLElement} container - Container element to render into
 * @param {Array} users - Array of user objects
 * @param {Object} currentUser - Current logged-in user
 * @param {Function} onEdit - Callback when edit is clicked
 * @param {Function} onRefresh - Callback to refresh the list
 */
export function renderUsersList(container, users, currentUser, onEdit, onRefresh) {
  container.innerHTML = '';

  if (users.length === 0) {
    container.append(h('div', {
      class: 'help',
      text: t('admin.users.noUsers', 'No users found.'),
    }));
    return;
  }

  const list = h('div', { class: 'admin-users-grid' });

  for (const u of users) {
    const card = renderUserCard(u, currentUser, onEdit, onRefresh);
    list.append(card);
  }

  container.append(list);
}
