/**
 * The settings tabs: one register for the page and its sidebar (B679).
 *
 * Each entry says what the tab is (key, label, factory), where it sits
 * (`section`) and who may reach it (`reach`, plus an optional installation
 * `feature`). The page builds, guards and routes from it; the sidebar draws
 * from it. There is no second list to keep in step.
 */

import { featureEnabled } from '../../lib/state/features.js';
import {
  createAccountTab,
  createPreferencesTab,
  createAdminTab,
  createUsersTab,
  createOrganizationTab,
  createEmailTab,
  createIntegrationsTab,
  createFontsTab,
  createThemesTab,
  createAnalyticsTab,
  createExportTab,
  createSlideTypesTab,
  createApiKeysTab,
  createHealthTab,
} from './tabs/index.js';

/**
 * What a viewer may reach, derived once per page from the user
 * (shared/organization-role.js).
 * @typedef {Object} SettingsAccess
 * @property {boolean} isAdmin - Admin in the active organization
 * @property {boolean} isInstanceAdmin - Installation administrator
 * @property {boolean} isDesigner - Has designer capability
 * @property {boolean} canSeeMembers - The members tab is reachable
 * @property {boolean} canSeeOrganization - The organization tab is reachable
 */

/** The gate per `reach` value. */
const REACH = {
  everyone: () => true,
  designer: ({ isDesigner }) => isDesigner,
  instance: ({ isInstanceAdmin }) => isInstanceAdmin,
  // Wider than `admin` on purpose: in multi-workspace mode every member may
  // see who else is in the organization and may leave it, and this is the tab
  // where both live.
  members: ({ canSeeMembers }) => canSeeMembers,
  // Profile is readable by every active member in multi-org; policy forms
  // need the active organization admin gate even in single-org mode.
  organizationOrPolicy: ({ canSeeOrganization, isAdmin }) =>
    canSeeOrganization || isAdmin,
};

/**
 * Every settings tab, in sidebar order.
 *
 * Technical keys remain stable while sections describe the scope shown to
 * the user. The users key is Organization members in multi-org mode and
 * Installation users in single-org mode.
 */
export const SETTINGS_TABS = Object.freeze([
  {
    key: 'account',
    scope: 'personal',
    section: 'personal',
    reach: 'everyone',
    labelKey: 'settings.tabs.account',
    label: 'Account',
    create: createAccountTab,
  },
  {
    key: 'preferences',
    scope: 'personal',
    section: 'personal',
    reach: 'everyone',
    labelKey: 'settings.tabs.preferences',
    label: 'Preferences',
    create: createPreferencesTab,
  },
  {
    key: 'export',
    scope: 'personal',
    section: 'personal',
    reach: 'everyone',
    labelKey: 'settings.tabs.export',
    label: 'Export my data',
    create: createExportTab,
  },
  {
    key: 'api-keys',
    scope: 'personal',
    section: 'personal',
    reach: 'everyone',
    feature: 'publicApi',
    labelKey: 'settings.tabs.apiKeys',
    label: 'My API keys',
    create: createApiKeysTab,
  },
  {
    key: 'organization',
    scope: 'organization',
    section: 'organization',
    reach: 'organizationOrPolicy',
    labelKey: 'settings.tabs.organization',
    label: 'Organization',
    create: createOrganizationTab,
  },
  {
    key: 'users',
    scope: 'contextual',
    section: 'organization',
    reach: 'members',
    labelKey: 'settings.tabs.users',
    label: 'Users',
    multiOrganizationLabelKey: 'settings.tabs.members',
    multiOrganizationLabel: 'Members',
    create: createUsersTab,
  },
  {
    key: 'fonts',
    scope: 'organization',
    section: 'designer',
    reach: 'designer',
    labelKey: 'settings.tabs.fonts',
    label: 'Fonts',
    create: createFontsTab,
  },
  {
    key: 'themes',
    scope: 'organization',
    section: 'designer',
    reach: 'designer',
    labelKey: 'settings.tabs.themes',
    label: 'Themes',
    create: createThemesTab,
  },
  {
    key: 'slide-types',
    scope: 'organization',
    section: 'designer',
    reach: 'designer',
    labelKey: 'settings.tabs.slideTypes',
    label: 'Slide Types',
    create: createSlideTypesTab,
  },
  {
    key: 'admin',
    scope: 'installation',
    section: 'instance',
    reach: 'instance',
    labelKey: 'settings.tabs.admin',
    label: 'General',
    create: createAdminTab,
  },
  {
    key: 'email',
    scope: 'installation',
    section: 'instance',
    reach: 'instance',
    labelKey: 'settings.tabs.email',
    label: 'Email',
    create: createEmailTab,
  },
  {
    key: 'integrations',
    scope: 'installation',
    section: 'instance',
    reach: 'instance',
    labelKey: 'settings.tabs.integrations',
    label: 'Webhooks',
    create: createIntegrationsTab,
  },
  {
    key: 'analytics',
    scope: 'installation',
    section: 'instance',
    reach: 'instance',
    labelKey: 'settings.tabs.analytics',
    label: 'External analytics',
    create: createAnalyticsTab,
  },
  {
    key: 'health',
    scope: 'installation',
    section: 'instance',
    reach: 'instance',
    labelKey: 'settings.tabs.health',
    label: 'Installation overview',
    create: createHealthTab,
  },
]);

/** The tab every unreachable or unknown hash lands on. */
export const DEFAULT_TAB = 'account';

/**
 * Whether this viewer may reach the tab: its role gate and, where it has one,
 * its installation feature.
 * @param {{reach: string, feature?: string}} tab
 * @param {SettingsAccess} access
 * @returns {boolean}
 */
function reaches(tab, access) {
  return (
    REACH[tab.reach](access) && (!tab.feature || featureEnabled(tab.feature))
  );
}

/**
 * The tabs this viewer may reach, in sidebar order.
 * @param {SettingsAccess} access
 * @returns {Array<Object>}
 */
export function reachableTabs(access) {
  return SETTINGS_TABS.filter((tab) => reaches(tab, access));
}

/**
 * The tab key to show for a requested key: the key itself when this viewer
 * may reach it, otherwise the default.
 * @param {string} key
 * @param {SettingsAccess} access
 * @returns {string}
 */
export function resolveTab(key, access) {
  const tab = SETTINGS_TABS.find((entry) => entry.key === key);
  return tab && reaches(tab, access) ? tab.key : DEFAULT_TAB;
}

/**
 * The sidebar groups tabs by visible scope. The contextual users tab belongs
 * to Organization in multi-org mode and Installation in single-org mode.
 * @param {SettingsAccess} access
 * @returns {{personal: Array<Object>, organization: Array<Object>, designer: Array<Object>, instance: Array<Object>}}
 */
export function sidebarSections(access) {
  const sections = {
    personal: [],
    organization: [],
    designer: [],
    instance: [],
  };
  for (const tab of reachableTabs(access)) {
    const section =
      tab.key === 'users' && !access.canSeeOrganization
        ? 'instance'
        : tab.section;
    sections[section].push(tab);
  }
  sections.instance.sort((a, b) =>
    a.key === 'admin' ? -1 : b.key === 'admin' ? 1 : 0,
  );
  return sections;
}
