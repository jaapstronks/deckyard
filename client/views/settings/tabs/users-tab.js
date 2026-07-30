/**
 * Users Tab Component
 *
 * One tab about people, two modes. On a single-workspace instance it wraps the
 * instance-wide admin user panel (client/views/settings/admin-users/), exactly
 * as before. In multi-workspace mode it *becomes* the member list of the
 * organization the session is currently in
 * (client/views/settings/organization-members/) — the instance-wide list would
 * show the wrong population there, scoped by home organization rather than by
 * membership.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderAdminUsersPanel } from '../admin-users/index.js';
import { renderOrganizationMembersPanel } from '../organization-members/index.js';
import { getFeatures } from '../../../lib/state/features.js';

/**
 * Create the users tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createUsersTab({ user }) {
  const isMultiWorkspace = Boolean(getFeatures()?.multiWorkspace);

  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-users',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-users-btn',
    'data-tab': 'users',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: isMultiWorkspace
      ? t('settings.tabs.members', 'Members')
      : t('settings.tabs.users', 'Users'),
  });

  let loaded = false;

  const load = () => {
    if (loaded) return;
    loaded = true;

    if (isMultiWorkspace) {
      container.append(renderOrganizationMembersPanel({ user }).el);
      return;
    }

    // Render the admin users panel (it handles its own data loading)
    const usersPanel = renderAdminUsersPanel({ user });
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
