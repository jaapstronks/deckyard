/**
 * API Keys Panel Component
 * Main panel for managing API keys with list, create, and revoke functionality.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { fetchApiKeys, renderKeyList, showCreateModal, showRevokeModal, showUsagePanel } from './api-keys/index.js';

/**
 * Render the API keys management panel.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {HTMLElement}
 */
export function renderApiKeysPanel({ user }) {
  const card = h('div', {
    class: 'stack editor-card api-keys-card',
  });

  // Header
  const header = h('div', { class: 'row is-between is-align-start', style: 'margin-bottom: 16px;' });

  const titleSection = h('div', { class: 'stack', style: 'gap: 4px;' });
  titleSection.append(
    h('div', {
      class: 'field-label',
      text: t('settings.apiKeys.title', 'API Keys'),
    }),
    h('div', {
      class: 'help',
      text: t(
        'settings.apiKeys.description',
        'Create and manage API keys for programmatic access to Deckyard.'
      ),
    })
  );

  const createBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('settings.apiKeys.createKey', 'Create API Key'),
  });

  header.append(titleSection, createBtn);

  // Toggle for showing revoked keys
  const toggleRow = h('div', { class: 'row', style: 'margin-bottom: 12px; gap: 8px;' });
  const showRevokedCheckbox = h('input', {
    type: 'checkbox',
    id: 'show-revoked-keys',
  });
  const showRevokedLabel = h('label', {
    for: 'show-revoked-keys',
    text: t('settings.apiKeys.showRevoked', 'Show revoked keys'),
    style: 'cursor: pointer;',
  });
  toggleRow.append(showRevokedCheckbox, showRevokedLabel);

  // Keys list container
  const keysList = h('div', { class: 'api-keys-list' });
  const loading = h('div', { class: 'help', text: t('common.loading', 'Loading...') });
  keysList.append(loading);

  // State
  let keys = [];
  let isLoading = false;
  let includeRevoked = false;

  /**
   * Load API keys from the server.
   */
  const loadKeys = async () => {
    if (isLoading) return;
    isLoading = true;

    keysList.innerHTML = '';
    keysList.append(h('div', { class: 'help', text: t('common.loading', 'Loading...') }));

    const result = await fetchApiKeys({ includeRevoked });

    isLoading = false;

    if (result.error) {
      keysList.innerHTML = '';
      keysList.append(h('div', { class: 'help', text: result.error }));
      return;
    }

    keys = result.keys;
    renderKeyList(keysList, keys, {
      onRevoke: handleRevoke,
      onViewUsage: handleViewUsage,
    });
  };

  /**
   * Handle revoke button click.
   * @param {Object} key - The key to revoke
   */
  const handleRevoke = (key) => {
    showRevokeModal(key, loadKeys);
  };

  /**
   * Handle view usage button click.
   * @param {Object} key - The key to view usage for
   */
  const handleViewUsage = (key) => {
    showUsagePanel(key);
  };

  // Event handlers
  createBtn.onclick = () => {
    showCreateModal(loadKeys);
  };

  showRevokedCheckbox.onchange = () => {
    includeRevoked = showRevokedCheckbox.checked;
    loadKeys();
  };

  // Assemble card
  card.append(header, toggleRow, keysList);

  // Initial load
  loadKeys();

  return card;
}
