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
 * @property {boolean} isDesigner - Has designer capability
 * @property {boolean} canSeeMembers - The members tab is reachable
 * @property {boolean} canSeeOrganization - The organization tab is reachable
 */

/** The gate per `reach` value. */
const REACH = {
  everyone: () => true,
  designer: ({ isDesigner }) => isDesigner,
  admin: ({ isAdmin }) => isAdmin,
  // Wider than `admin` on purpose: in multi-workspace mode every member may
  // see who else is in the organization and may leave it, and this is the tab
  // where both live.
  members: ({ canSeeMembers }) => canSeeMembers,
  // Multi-workspace only, and then for everyone in the organization:
  // `GET /api/organizations/:id` answers to any member, and what may be
  // changed is decided inside the panel.
  organization: ({ canSeeOrganization }) => canSeeOrganization,
};

/**
 * Every settings tab, in sidebar order.
 *
 * `section: 'admin'` with a reach wider than `admin` (organization, members)
 * sits in the Admin group for an admin, where the people tab has always been;
 * a plain member who reaches it gets it with the personal tabs instead,
 * because an "Admin" divider over someone who is not one is a lie about what
 * they are looking at. The organization comes before its people: what this
 * workspace is, then who is in it.
 */
export const SETTINGS_TABS = Object.freeze([
  {
    key: 'account',
    section: 'personal',
    reach: 'everyone',
    labelKey: 'settings.tabs.account',
    label: 'Account',
    create: createAccountTab,
  },
  {
    key: 'preferences',
    section: 'personal',
    reach: 'everyone',
    labelKey: 'settings.tabs.preferences',
    label: 'Preferences',
    create: createPreferencesTab,
  },
  {
    key: 'export',
    section: 'personal',
    reach: 'everyone',
    labelKey: 'settings.tabs.export',
    label: 'Data Export',
    create: createExportTab,
  },
  {
    key: 'fonts',
    section: 'designer',
    reach: 'designer',
    labelKey: 'settings.tabs.fonts',
    label: 'Fonts',
    create: createFontsTab,
  },
  {
    key: 'themes',
    section: 'designer',
    reach: 'designer',
    labelKey: 'settings.tabs.themes',
    label: 'Themes',
    create: createThemesTab,
  },
  {
    key: 'slide-types',
    section: 'designer',
    reach: 'designer',
    labelKey: 'settings.tabs.slideTypes',
    label: 'Slide Types',
    create: createSlideTypesTab,
  },
  {
    key: 'admin',
    section: 'admin',
    reach: 'admin',
    labelKey: 'settings.tabs.admin',
    label: 'Admin',
    create: createAdminTab,
  },
  {
    key: 'organization',
    section: 'admin',
    reach: 'organization',
    labelKey: 'settings.tabs.organization',
    label: 'Organization',
    create: createOrganizationTab,
  },
  {
    key: 'users',
    section: 'admin',
    reach: 'members',
    labelKey: 'settings.tabs.users',
    label: 'Users',
    // In multi-workspace mode this tab lists the members of the organization
    // the session is in, not every user on the instance, so it says so. See
    // tabs/users-tab.js.
    multiOrganizationLabelKey: 'settings.tabs.members',
    multiOrganizationLabel: 'Members',
    create: createUsersTab,
  },
  {
    key: 'api-keys',
    section: 'admin',
    reach: 'admin',
    // The public API cluster: without it the tab is absent and its hash lands
    // on the default (D260).
    feature: 'publicApi',
    labelKey: 'settings.tabs.apiKeys',
    label: 'API Keys',
    create: createApiKeysTab,
  },
  {
    key: 'email',
    section: 'admin',
    reach: 'admin',
    labelKey: 'settings.tabs.email',
    label: 'Email',
    create: createEmailTab,
  },
  {
    key: 'integrations',
    section: 'admin',
    reach: 'admin',
    labelKey: 'settings.tabs.integrations',
    label: 'Integrations',
    create: createIntegrationsTab,
  },
  {
    key: 'analytics',
    section: 'admin',
    reach: 'admin',
    labelKey: 'settings.tabs.analytics',
    label: 'External Analytics',
    create: createAnalyticsTab,
  },
  {
    key: 'health',
    section: 'admin',
    reach: 'admin',
    labelKey: 'settings.tabs.health',
    label: 'Instance Health',
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
  return tab && reaches(tab, access) ? key : DEFAULT_TAB;
}

/**
 * The sidebar's groups for this viewer. An admin-section tab reached by
 * someone who is not an admin moves to the personal group (see SETTINGS_TABS).
 * @param {SettingsAccess} access
 * @returns {{personal: Array<Object>, designer: Array<Object>, admin: Array<Object>}}
 */
export function sidebarSections(access) {
  const { isAdmin } = access;
  const sections = { personal: [], designer: [], admin: [] };
  for (const tab of reachableTabs(access)) {
    const section =
      tab.section === 'admin' && !isAdmin ? 'personal' : tab.section;
    sections[section].push(tab);
  }
  return sections;
}
