/**
 * Admin user management panel.
 * Displays a list of users with options to add, edit, and delete.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { renderUsersList, showAddModal, showEditModal, fetchUsers } from './admin-users/index.js';

/**
 * Render the admin users panel.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {HTMLElement} - The panel element
 */
export function renderAdminUsersPanel({ user }) {
  const card = h('div', {
    class: 'stack editor-card admin-users-card',
    style: user?.isAdmin ? '' : 'display:none;',
  });

  const cardTitle = h('div', {
    class: 'field-label',
    text: t('admin.users.title', 'User management'),
  });

  const cardHint = h('div', {
    class: 'help',
    text: t(
      'admin.users.help',
      'Add, edit, or remove users. New users will receive an email invitation to set up their account.'
    ),
  });

  const addBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('admin.users.addUser', 'Add user'),
  });

  const usersList = h('div', { class: 'admin-users-list' });
  const loading = h('div', {
    class: 'help',
    text: t('common.loading', 'Loading…'),
  });
  usersList.append(loading);

  // State
  let users = [];
  let isLoading = false;

  // Load users
  const loadUsers = async () => {
    if (isLoading) return;
    isLoading = true;

    await fetchUsers(
      (loadedUsers) => {
        users = loadedUsers;
        renderUsersList(usersList, users, user, handleEdit, loadUsers);
      },
      () => {
        usersList.innerHTML = '';
        usersList.append(h('div', {
          class: 'help',
          text: t('admin.users.loadFailed', 'Failed to load users.'),
        }));
      }
    );

    isLoading = false;
  };

  // Edit handler
  const handleEdit = (targetUser) => {
    showEditModal(targetUser, loadUsers);
  };

  // Event handlers
  addBtn.onclick = () => showAddModal(loadUsers);

  // Initial fetch
  if (user?.isAdmin) {
    loadUsers();
  }

  const header = h('div', { class: 'row is-between is-align-start', style: 'margin-bottom: 12px;' });
  header.append(h('div', { class: 'stack', style: 'gap: 4px;' }, [cardTitle, cardHint]), addBtn);

  card.append(header, usersList);

  return card;
}
