/**
 * Settings Sidebar Component
 * Vertical sidebar nav (desktop) / horizontal tabs (mobile)
 */

import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { getFeatures } from '../../lib/state/features.js';
import { sidebarSections } from './tab-registry.js';
import { fetchOrganization } from './organization-profile/actions.js';
import { debugLog } from '../../lib/state/debug.js';

/**
 * Create the settings sidebar component.
 * @param {Object} options
 * @param {boolean} options.isAdmin - Admin of the active organization
 * @param {boolean} options.isInstanceAdmin - Installation administrator
 * @param {boolean} options.isDesigner - Whether user has designer capability
 * @param {boolean} [options.canSeeMembers] - Whether the members tab is reachable
 * @param {boolean} [options.canSeeOrganization] - Whether the organization tab is reachable
 * @param {string} [options.organizationId] - Active organization for the scope heading
 * @param {string} options.activeTab - Currently active tab key
 * @param {Function} options.onTabChange - Callback when tab changes
 * @returns {{el: HTMLElement, setActiveTab: Function}}
 */
export function createSettingsSidebar({
  isAdmin,
  isInstanceAdmin,
  isDesigner,
  canSeeMembers = isAdmin,
  canSeeOrganization = false,
  organizationId = null,
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
    isInstanceAdmin,
    isDesigner,
    canSeeMembers,
    canSeeOrganization,
  });

  // Personal settings stay personal regardless of the active organization.
  for (const tab of sections.personal) {
    sidebar.append(createTabButton(tab));
  }

  const appendSection = (tabs, label) => {
    if (!tabs.length) return null;
    const divider = h('div', { class: 'settings-sidebar-divider' });
    const caption = h('span', {
      class: 'settings-sidebar-divider-label',
      text: label,
    });
    divider.append(caption);
    sidebar.append(divider);
    for (const tab of tabs) sidebar.append(createTabButton(tab));
    return caption;
  };

  const organizationCaption = appendSection(
    sections.organization,
    t('settings.tabs.organizationSection', 'Organization'),
  );
  if (
    organizationCaption &&
    getFeatures()?.multiOrganization &&
    organizationId
  ) {
    fetchOrganization(organizationId)
      .then(({ organization }) => {
        if (organization)
          organizationCaption.textContent =
            organization.displayName || organization.name;
      })
      .catch((err) => debugLog('Active organization name unavailable', err));
  }

  // Add designer section if user has designer capability
  appendSection(
    sections.designer,
    t('settings.tabs.designerSection', 'Design'),
  );

  // Add admin section if user is admin
  appendSection(
    sections.instance,
    t('settings.tabs.adminSection', 'Installation'),
  );

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
