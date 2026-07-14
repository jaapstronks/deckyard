/**
 * API Keys Tab Component
 * Wraps the API keys panel for the settings page.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderApiKeysPanel } from '../api-keys-panel.js';
import { renderMcpConnectCard } from '../api-keys/index.js';

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
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-api-keys-btn',
    'data-tab': 'api-keys',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.apiKeys', 'API Keys'),
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
  };

  container.append(title);

  return {
    el: container,
    load,
  };
}
