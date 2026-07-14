/**
 * Settings Sidebar Component
 * Vertical sidebar nav (desktop) / horizontal tabs (mobile)
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Tab configuration for settings page.
 * Tabs are grouped: user tabs first, designer tabs, then admin tabs.
 */
const USER_TABS = [
  { key: 'account', labelKey: 'settings.tabs.account', labelDefault: 'Account' },
  { key: 'preferences', labelKey: 'settings.tabs.preferences', labelDefault: 'Preferences' },
  { key: 'export', labelKey: 'settings.tabs.export', labelDefault: 'Data Export' },
];

const DESIGNER_TABS = [
  { key: 'fonts', labelKey: 'settings.tabs.fonts', labelDefault: 'Fonts' },
  { key: 'themes', labelKey: 'settings.tabs.themes', labelDefault: 'Themes' },
  { key: 'slide-types', labelKey: 'settings.tabs.slideTypes', labelDefault: 'Slide Types' },
];

const ADMIN_TABS = [
  { key: 'admin', labelKey: 'settings.tabs.admin', labelDefault: 'Admin' },
  { key: 'users', labelKey: 'settings.tabs.users', labelDefault: 'Users' },
  { key: 'api-keys', labelKey: 'settings.tabs.apiKeys', labelDefault: 'API Keys' },
  { key: 'email', labelKey: 'settings.tabs.email', labelDefault: 'Email' },
  { key: 'integrations', labelKey: 'settings.tabs.integrations', labelDefault: 'Integrations' },
  { key: 'analytics', labelKey: 'settings.tabs.analytics', labelDefault: 'External Analytics' },
];

/**
 * Create the settings sidebar component.
 * @param {Object} options
 * @param {boolean} options.isAdmin - Whether user is admin
 * @param {boolean} options.isDesigner - Whether user has designer capability
 * @param {string} options.activeTab - Currently active tab key
 * @param {Function} options.onTabChange - Callback when tab changes
 * @returns {Object} { el, setActiveTab }
 */
export function createSettingsSidebar({ isAdmin, isDesigner, activeTab, onTabChange }) {
  const sidebar = h('nav', {
    class: 'settings-sidebar',
    role: 'tablist',
    'aria-label': t('settings.tabs.ariaLabel', 'Settings navigation'),
  });

  const tabButtons = {};

  // Create a tab button
  const createTabButton = (tab) => {
    const isActive = tab.key === activeTab;
    const btn = h('button', {
      class: `settings-sidebar-tab ${isActive ? 'is-active' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': isActive ? 'true' : 'false',
      'aria-controls': `settings-tab-${tab.key}`,
      'data-tab': tab.key,
      onclick: () => {
        if (onTabChange) onTabChange(tab.key);
      },
    });

    const label = h('span', {
      class: 'settings-sidebar-tab-label',
      text: t(tab.labelKey, tab.labelDefault),
    });

    btn.append(label);
    tabButtons[tab.key] = btn;
    return btn;
  };

  // Add user tabs
  for (const tab of USER_TABS) {
    sidebar.append(createTabButton(tab));
  }

  // Add designer section if user has designer capability
  if (isDesigner) {
    const designerDivider = h('div', { class: 'settings-sidebar-divider' });
    const designerDividerLabel = h('span', {
      class: 'settings-sidebar-divider-label',
      text: t('settings.tabs.designerSection', 'Designer'),
    });
    designerDivider.append(designerDividerLabel);
    sidebar.append(designerDivider);

    for (const tab of DESIGNER_TABS) {
      sidebar.append(createTabButton(tab));
    }
  }

  // Add admin section if user is admin
  if (isAdmin) {
    const divider = h('div', { class: 'settings-sidebar-divider' });
    const dividerLabel = h('span', {
      class: 'settings-sidebar-divider-label',
      text: t('settings.tabs.adminSection', 'Admin'),
    });
    divider.append(dividerLabel);
    sidebar.append(divider);

    for (const tab of ADMIN_TABS) {
      sidebar.append(createTabButton(tab));
    }
  }

  const setActiveTab = (tabKey) => {
    for (const [key, btn] of Object.entries(tabButtons)) {
      const isActive = key === tabKey;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  };

  // Build list of visible tabs for external reference
  const visibleTabs = [
    ...USER_TABS,
    ...(isDesigner ? DESIGNER_TABS : []),
    ...(isAdmin ? ADMIN_TABS : []),
  ];

  return {
    el: sidebar,
    setActiveTab,
    visibleTabs,
  };
}