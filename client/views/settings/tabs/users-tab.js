/**
 * Users Tab Component
 * Wraps the existing admin-users-panel
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderAdminUsersPanel } from '../admin-users-panel.js';

/**
 * Create the users tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createUsersTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-users',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-users-btn',
    'data-tab': 'users',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.users', 'Users'),
  });

  let loaded = false;
  let usersPanel = null;

  const load = () => {
    if (loaded) return;
    loaded = true;

    // Render the admin users panel (it handles its own data loading)
    usersPanel = renderAdminUsersPanel({ user });
    // Remove the visibility style since it's controlled by the tab
    usersPanel.style.display = '';
    container.append(usersPanel);
  };

  container.append(title);

  return {
    el: container,
    load,
  };
}