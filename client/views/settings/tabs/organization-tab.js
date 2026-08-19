/**
 * Organization Tab Component
 *
 * The organization the session is currently in: its name, how it is displayed,
 * and — for its owner — the way to delete it. Multi-workspace only; on a
 * single-workspace instance there is no organization to switch between and the
 * whole `/api/organizations` surface answers 403, so the tab is not registered
 * at all (see views/settings/index.js).
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderOrganizationProfilePanel } from '../organization-profile/index.js';

/**
 * Create the organization tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createOrganizationTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-organization',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-organization-btn',
    'data-tab': 'organization',
  });

  container.append(
    h('h2', {
      class: 'settings-tab-title',
      text: t('settings.tabs.organization', 'Organization'),
    }),
  );

  let loaded = false;

  const load = () => {
    if (loaded) return;
    loaded = true;
    container.append(renderOrganizationProfilePanel({ user }).el);
  };

  return { el: container, load };
}
