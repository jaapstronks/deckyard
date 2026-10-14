/**
 * Settings Sidebar Component
 * Vertical sidebar nav (desktop) / horizontal tabs (mobile)
 */

import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { getFeatures } from '../../lib/state/features.js';
import { sidebarSections } from './tab-registry.js';

/**
 * Create the settings sidebar component.
 * @param {Object} options
 * @param {boolean} options.isAdmin - Whether user is admin
 * @param {boolean} options.isDesigner - Whether user has designer capability
 * @param {boolean} [options.canSeeMembers] - Whether the members tab is reachable
 * @param {boolean} [options.canSeeOrganization] - Whether the organization tab is reachable
 * @param {string} options.activeTab - Currently active tab key
 * @param {Function} options.onTabChange - Callback when tab changes
 * @returns {{el: HTMLElement, setActiveTab: Function}}
 */
export function createSettingsSidebar({
  isAdmin,
  isDesigner,
  canSeeMembers = isAdmin,
  canSeeOrganization = false,
  activeTab,
  onTabChange,
}) {
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
      id: `settings-tab-${tab.key}-btn`,
      'data-tab': tab.key,
      onclick: () => {
        if (onTabChange) onTabChange(tab.key);
      },
    });

    const renamed =
      tab.multiOrganizationLabelKey && getFeatures()?.multiOrganization;
    const label = h('span', {
      class: 'settings-sidebar-tab-label',
      text: renamed
        ? t(tab.multiOrganizationLabelKey, tab.multiOrganizationLabel)
        : t(tab.labelKey, tab.label),
    });

    btn.append(label);
    tabButtons[tab.key] = btn;
    return btn;
  };

  const sections = sidebarSections({
    isAdmin,
    isDesigner,
    canSeeMembers,
    canSeeOrganization,
  });

  // The personal tabs, with the organization tabs for a member who is not an
  // admin (see tab-registry.js).
  for (const tab of sections.personal) {
    sidebar.append(createTabButton(tab));
  }

  // Add designer section if user has designer capability
  if (sections.designer.length) {
    const designerDivider = h('div', { class: 'settings-sidebar-divider' });
    const designerDividerLabel = h('span', {
      class: 'settings-sidebar-divider-label',
      text: t('settings.tabs.designerSection', 'Designer'),
    });
    designerDivider.append(designerDividerLabel);
    sidebar.append(designerDivider);

    for (const tab of sections.designer) {
      sidebar.append(createTabButton(tab));
    }
  }

  // Add admin section if user is admin
  if (sections.admin.length) {
    const divider = h('div', { class: 'settings-sidebar-divider' });
    const dividerLabel = h('span', {
      class: 'settings-sidebar-divider-label',
      text: t('settings.tabs.adminSection', 'Admin'),
    });
    divider.append(dividerLabel);
    sidebar.append(divider);

    for (const tab of sections.admin) {
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

  return {
    el: sidebar,
    setActiveTab,
  };
}
