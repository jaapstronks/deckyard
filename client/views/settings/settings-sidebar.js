/**
 * Settings Sidebar Component
 * Vertical sidebar nav (desktop) / horizontal tabs (mobile)
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { getFeatures } from '../../lib/state/features.js';

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

/**
 * The two organization tabs. Both sit inside the Admin group for an admin —
 * where the people tab has always been — but in multi-workspace mode a plain
 * member reaches them too (slices 5 and 6), and drawing an "Admin" divider for
 * someone who is not one would be a lie about what they are looking at. So for
 * them these are appended to the personal tabs instead, and the same entries
 * are used either way.
 *
 * The organization comes before its people, which is also the order the two
 * screens read in: what this workspace is, then who is in it.
 */
const ORGANIZATION_TAB = {
  key: 'organization',
  labelKey: 'settings.tabs.organization',
  labelDefault: 'Organization',
};

const MEMBERS_TAB = {
  key: 'users',
  labelKey: 'settings.tabs.users',
  labelDefault: 'Users',
  // In multi-workspace mode this tab lists the members of the organization
  // the session is in, not every user on the instance — so it says so. See
  // tabs/users-tab.js.
  multiOrganizationLabelKey: 'settings.tabs.members',
  multiOrganizationLabelDefault: 'Members',
};

const ADMIN_TABS = [
  { key: 'admin', labelKey: 'settings.tabs.admin', labelDefault: 'Admin' },
  ORGANIZATION_TAB,
  MEMBERS_TAB,
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
 * @param {boolean} [options.canSeeMembers] - Whether the members tab is reachable
 * @param {boolean} [options.canSeeOrganization] - Whether the organization tab is reachable
 * @param {string} options.activeTab - Currently active tab key
 * @param {Function} options.onTabChange - Callback when tab changes
 * @returns {Object} { el, setActiveTab }
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
      'data-tab': tab.key,
      onclick: () => {
        if (onTabChange) onTabChange(tab.key);
      },
    });

    const renamed = tab.multiOrganizationLabelKey && getFeatures()?.multiOrganization;
    const label = h('span', {
      class: 'settings-sidebar-tab-label',
      text: renamed
        ? t(tab.multiOrganizationLabelKey, tab.multiOrganizationLabelDefault)
        : t(tab.labelKey, tab.labelDefault),
    });

    btn.append(label);
    tabButtons[tab.key] = btn;
    return btn;
  };

  // Add user tabs
  for (const tab of USER_TABS) {
    sidebar.append(createTabButton(tab));
  }

  // A member who is not an admin gets the organization tabs here, with the
  // personal ones. Admins get them below, in the Admin group, where the members
  // tab has always been.
  const personalWorkspaceTabs = [
    ...(canSeeOrganization && !isAdmin ? [ORGANIZATION_TAB] : []),
    ...(canSeeMembers && !isAdmin ? [MEMBERS_TAB] : []),
  ];
  for (const tab of personalWorkspaceTabs) {
    sidebar.append(createTabButton(tab));
  }

  // The organization tab only exists in multi-workspace mode, so an admin on a
  // single-workspace instance keeps the Admin group they always had.
  const adminTabs = ADMIN_TABS.filter(
    (tab) => tab.key !== ORGANIZATION_TAB.key || canSeeOrganization
  );

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

    for (const tab of adminTabs) {
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
    ...personalWorkspaceTabs,
    ...(isDesigner ? DESIGNER_TABS : []),
    ...(isAdmin ? adminTabs : []),
  ];

  return {
    el: sidebar,
    setActiveTab,
    visibleTabs,
  };
}