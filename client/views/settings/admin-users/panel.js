/**
 * Admin user management panel.
 * Displays a list of users with options to add, edit, and delete.
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderUsersList } from './user-list.js';
import { showAddModal } from './add-modal.js';
import { showEditModal } from './edit-modal.js';
import { fetchUsers } from './actions.js';
import { createListPager } from '../../../lib/dom/list-pager.js';
import { isOrganizationAdmin } from '../../../../shared/organization-role.js';

/**
 * Render the admin users panel.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {HTMLElement} - The panel element
 */
export function renderAdminUsersPanel({ user }) {
  const canManage = isOrganizationAdmin(user);
  const card = h('div', {
    class: 'stack editor-card admin-users-card',
    style: canManage ? '' : 'display:none;',
  });

  const cardTitle = h('div', {
    class: 'field-label',
    text: t('admin.users.title', 'User management'),
  });

  const cardHint = h('div', {
    class: 'help',
    text: t(
      'admin.users.help',
      'Add, edit, or remove users. New users will receive an email invitation to set up their account.',
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

  // Everything loaded so far; the pager reads the next page on "Load more".
  let users = [];
  const pager = createListPager({
    fetchPage: (_params, cursor) => fetchUsers(cursor),
    onPage: (items, { first }) => {
      users = first ? items : [...users, ...items];
      renderUsersList(usersList, users, user, handleEdit, loadUsers);
    },
  });

  // (Re)load from the top: after an add, edit or delete, and on open.
  const loadUsers = async () => {
    try {
      await pager.load();
    } catch {
      usersList.replaceChildren();
      usersList.append(
        h('div', {
          class: 'help',
          text: t('admin.users.loadFailed', 'Failed to load users.'),
        }),
      );
    }
  };

  // Edit handler
  const handleEdit = (targetUser) => {
    showEditModal(targetUser, loadUsers);
  };

  // Event handlers
  addBtn.onclick = () => showAddModal(loadUsers);

  // Initial fetch
  if (canManage) {
    loadUsers();
  }

  const header = h('div', {
    class: 'row is-between is-align-start admin-users-header',
    style: 'margin-bottom: 12px;',
  });
  header.append(
    h('div', { class: 'stack', style: 'gap: 4px;' }, [cardTitle, cardHint]),
    addBtn,
  );

  card.append(header, usersList, pager.el);

  return card;
}
