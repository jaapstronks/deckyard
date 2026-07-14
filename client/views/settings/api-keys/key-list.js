/**
 * API Keys list component - renders the table of API keys.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Format a date as relative time (e.g., "2 days ago").
 * @param {string|Date} date - Date to format
 * @returns {string}
 */
function formatRelativeDate(date) {
  if (!date) return t('settings.apiKeys.never', 'Never');

  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return t('settings.apiKeys.justNow', 'Just now');
  if (diffMins < 60) return t('settings.apiKeys.minutesAgo', '{n} min ago', { n: diffMins });
  if (diffHours < 24) return t('settings.apiKeys.hoursAgo', '{n}h ago', { n: diffHours });
  if (diffDays < 30) return t('settings.apiKeys.daysAgo', '{n}d ago', { n: diffDays });

  return d.toLocaleDateString();
}

/**
 * Create a scope badge element.
 * @param {string} scope - Scope name
 * @returns {HTMLElement}
 */
function createScopeBadge(scope) {
  return h('span', {
    class: 'api-key-scope-badge',
    text: scope,
    title: getScopeDescription(scope),
  });
}

/**
 * Get description for a scope.
 * @param {string} scope - Scope name
 * @returns {string}
 */
function getScopeDescription(scope) {
  const descriptions = {
    read: t('settings.apiKeys.scopeDesc.read', 'Read presentations, themes, and slide types'),
    write: t('settings.apiKeys.scopeDesc.write', 'Create, update, and delete presentations'),
    ai: t('settings.apiKeys.scopeDesc.ai', 'Use AI generation and refinement features'),
    export: t('settings.apiKeys.scopeDesc.export', 'Export presentations to HTML, JSON, or PDF'),
  };
  return descriptions[scope] || scope;
}

/**
 * Render the empty state when no keys exist.
 * @returns {HTMLElement}
 */
function renderEmptyState() {
  return h('div', { class: 'api-keys-empty-state' }, [
    h('p', {
      class: 'help',
      text: t(
        'settings.apiKeys.emptyState',
        'No API keys yet. Create one to connect AI agents, automation tools, or external services.'
      ),
    }),
  ]);
}

/**
 * Render a single API key row.
 * @param {Object} key - Key data
 * @param {Function} onRevoke - Revoke callback
 * @param {Function} onViewUsage - View usage callback
 * @returns {HTMLElement}
 */
function renderKeyRow(key, onRevoke, onViewUsage) {
  const isRevoked = Boolean(key.revokedAt);

  const row = h('div', {
    class: `api-key-row ${isRevoked ? 'is-revoked' : ''}`,
    'data-key-id': key.id,
  });

  // Key info column
  const infoCol = h('div', { class: 'api-key-info' });

  const nameRow = h('div', { class: 'api-key-name-row' });
  nameRow.append(
    h('span', { class: 'api-key-name', text: key.name }),
    isRevoked
      ? h('span', { class: 'api-key-status-badge is-revoked', text: t('settings.apiKeys.revoked', 'Revoked') })
      : h('span', { class: 'api-key-status-badge is-active', text: t('settings.apiKeys.active', 'Active') })
  );

  const prefixRow = h('div', { class: 'api-key-prefix-row' });
  const prefixCode = h('code', {
    class: 'api-key-prefix',
    text: `${key.prefix}...`,
  });
  const copyBtn = h('button', {
    class: 'btn btn-secondary api-key-copy-prefix',
    type: 'button',
    title: t('settings.apiKeys.copyPrefix', 'Copy prefix'),
    text: t('settings.apiKeys.copy', 'Copy'),
  });
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(key.prefix);
    copyBtn.textContent = t('settings.apiKeys.copied', 'Copied!');
    setTimeout(() => {
      copyBtn.textContent = t('settings.apiKeys.copy', 'Copy');
    }, 2000);
  };
  prefixRow.append(prefixCode, copyBtn);

  infoCol.append(nameRow, prefixRow);

  // Scopes column
  const scopesCol = h('div', { class: 'api-key-scopes' });
  for (const scope of key.scopes || []) {
    scopesCol.append(createScopeBadge(scope));
  }

  // Dates column
  const datesCol = h('div', { class: 'api-key-dates' });
  datesCol.append(
    h('div', { class: 'api-key-date' }, [
      h('span', { class: 'api-key-date-label', text: t('settings.apiKeys.created', 'Created:') }),
      h('span', { text: formatRelativeDate(key.createdAt) }),
    ]),
    h('div', { class: 'api-key-date' }, [
      h('span', { class: 'api-key-date-label', text: t('settings.apiKeys.lastUsed', 'Last used:') }),
      h('span', { text: formatRelativeDate(key.lastUsedAt) }),
    ])
  );

  // Actions column
  const actionsCol = h('div', { class: 'api-key-actions' });

  if (!isRevoked) {
    const usageBtn = h('button', {
      class: 'btn btn-small btn-secondary',
      type: 'button',
      text: t('settings.apiKeys.viewUsage', 'Usage'),
    });
    usageBtn.onclick = () => onViewUsage(key);

    const revokeBtn = h('button', {
      class: 'btn btn-small btn-danger',
      type: 'button',
      text: t('settings.apiKeys.revoke', 'Revoke'),
    });
    revokeBtn.onclick = () => onRevoke(key);

    actionsCol.append(usageBtn, revokeBtn);
  }

  row.append(infoCol, scopesCol, datesCol, actionsCol);
  return row;
}

/**
 * Render the API keys list.
 * @param {HTMLElement} container - Container element to render into
 * @param {Array} keys - Array of API key objects
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onRevoke - Called when revoke is clicked
 * @param {Function} callbacks.onViewUsage - Called when usage is clicked
 */
export function renderKeyList(container, keys, { onRevoke, onViewUsage }) {
  container.innerHTML = '';

  if (!keys || keys.length === 0) {
    container.append(renderEmptyState());
    return;
  }

  // Header row
  const header = h('div', { class: 'api-key-row api-key-header' });
  header.append(
    h('div', { class: 'api-key-info', text: t('settings.apiKeys.headerName', 'Name & Key') }),
    h('div', { class: 'api-key-scopes', text: t('settings.apiKeys.headerScopes', 'Scopes') }),
    h('div', { class: 'api-key-dates', text: t('settings.apiKeys.headerDates', 'Dates') }),
    h('div', { class: 'api-key-actions', text: t('settings.apiKeys.headerActions', 'Actions') })
  );
  container.append(header);

  // Key rows
  for (const key of keys) {
    container.append(renderKeyRow(key, onRevoke, onViewUsage));
  }
}
