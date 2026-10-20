/**
 * API Keys Tab Component
 * Wraps the API keys panel for the settings page.
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderApiKeysPanel, renderMcpConnectCard } from '../api-keys/index.js';
import { fetchOrganization } from '../organization-profile/actions.js';
import { getFeatures } from '../../../lib/state/features.js';
import { debugLog } from '../../../lib/state/debug.js';

/**
 * Create the API keys tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createApiKeysTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-api-keys',
    'data-tab': 'api-keys',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.apiKeys', 'My API keys'),
  });
  const scope = h('p', {
    class: 'settings-tab-description',
    text: `${t('settings.apiKeys.activeOrganization', 'Active organization')}: ${user?.organizationId || '—'}`,
  });

  let loaded = false;
  let panel = null;

  const load = () => {
    if (loaded) return;
    loaded = true;

    // Render the API keys panel, then the "Connect via API / MCP" card —
    // remote MCP authenticates with the keys created just above.
    panel = renderApiKeysPanel({ user });
    container.append(panel, renderMcpConnectCard());
    if (getFeatures()?.multiOrganization && user?.organizationId) {
      fetchOrganization(user.organizationId)
        .then(({ organization }) => {
          if (organization)
            scope.textContent = `${t('settings.apiKeys.activeOrganization', 'Active organization')}: ${organization.displayName || organization.name}`;
        })
        .catch((err) => debugLog('Active organization name unavailable', err));
    }
  };

  container.append(title, scope);

  return {
    el: container,
    load,
  };
}
