/**
 * Settings Page
 * Main settings page with tabbed navigation
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { createSettingsSidebar } from './settings-sidebar.js';
import {
  createAccountTab,
  createPreferencesTab,
  createAdminTab,
  createUsersTab,
  createEmailTab,
  createIntegrationsTab,
  createFontsTab,
  createThemesTab,
  createAnalyticsTab,
  createExportTab,
  createSlideTypesTab,
  createApiKeysTab,
} from './tabs/index.js';

const DEFAULT_TAB = 'account';
const DESIGNER_TABS = ['fonts', 'themes', 'slide-types'];
const ADMIN_TABS = ['admin', 'users', 'api-keys', 'email', 'integrations', 'analytics'];

/**
 * Get the active tab from the URL hash.
 * @param {boolean} isAdmin - Whether user is admin
 * @param {boolean} isDesigner - Whether user has designer capability
 * @returns {string} Tab key
 */
function getTabFromHash(isAdmin, isDesigner) {
  const hash = location.hash.slice(1); // Remove #
  if (!hash) return DEFAULT_TAB;

  // Guard designer tabs from non-designer access
  if (DESIGNER_TABS.includes(hash) && !isDesigner) {
    return DEFAULT_TAB;
  }

  // Guard admin tabs from non-admin access
  if (ADMIN_TABS.includes(hash) && !isAdmin) {
    return DEFAULT_TAB;
  }

  const validTabs = [
    'account', 'preferences', 'export',
    ...(isDesigner ? DESIGNER_TABS : []),
    ...(isAdmin ? ADMIN_TABS : []),
  ];

  return validTabs.includes(hash) ? hash : DEFAULT_TAB;
}

/**
 * Set the URL hash without triggering navigation.
 * @param {string} tab - Tab key
 */
function setTabHash(tab) {
  const newHash = `#${tab}`;
  if (location.hash !== newHash) {
    history.replaceState(null, '', `/settings${newHash}`);
  }
}

/**
 * Render the settings page.
 * @param {HTMLElement} root - Root element
 * @param {Object} options
 * @param {Function} options.nav - Navigation function
 * @param {Object} options.user - Current user
 * @returns {Function|null} Cleanup function
 */
export async function renderSettingsPage(root, { nav, user } = {}) {
  const isAdmin = Boolean(user?.isAdmin);
  const isDesigner = Boolean(user?.isDesigner);
  const initialTab = getTabFromHash(isAdmin, isDesigner);

  const shell = h('div', { class: 'app-shell settings-page' });

  // Topbar
  const topbar = h('header', { class: 'topbar settings-topbar', role: 'banner' });
  const backBtn = h('button', {
    class: 'btn btn-secondary btn-icon',
    'aria-label': t('common.back', 'Back'),
    title: t('common.back', 'Back'),
    onclick: () => nav?.('/app'),
  });
  const backIcon = h('span', { text: '\u2190' }); // ←
  backBtn.append(backIcon);

  const topbarTitle = h('div', { class: 'topbar-title' });
  topbarTitle.append(
    h('h1', {
      class: 'settings-page-title',
      text: t('settings.title', 'Settings'),
    })
  );

  topbar.append(backBtn, topbarTitle);
  shell.append(topbar);

  // Create tabs
  const tabs = {};
  const tabLoaders = {};

  // Account tab (always visible)
  const accountTab = createAccountTab({ user });
  tabs.account = accountTab.el;
  tabLoaders.account = accountTab.load;

  // Preferences tab (always visible)
  const preferencesTab = createPreferencesTab({ user, nav });
  tabs.preferences = preferencesTab.el;
  tabLoaders.preferences = preferencesTab.load;

  // Export tab (always visible)
  const exportTab = createExportTab({ user });
  tabs.export = exportTab.el;
  tabLoaders.export = exportTab.load;

  // Designer tabs
  if (isDesigner) {
    const fontsTab = createFontsTab({ user });
    tabs.fonts = fontsTab.el;
    tabLoaders.fonts = fontsTab.load;

    const themesTab = createThemesTab({ user });
    tabs.themes = themesTab.el;
    tabLoaders.themes = themesTab.load;

    const slideTypesTab = createSlideTypesTab({ user });
    tabs['slide-types'] = slideTypesTab.el;
    tabLoaders['slide-types'] = slideTypesTab.load;
  }

  // Admin tabs
  if (isAdmin) {
    const adminTab = createAdminTab({ user });
    tabs.admin = adminTab.el;
    tabLoaders.admin = adminTab.load;

    const usersTab = createUsersTab({ user });
    tabs.users = usersTab.el;
    tabLoaders.users = usersTab.load;

    const apiKeysTab = createApiKeysTab({ user });
    tabs['api-keys'] = apiKeysTab.el;
    tabLoaders['api-keys'] = apiKeysTab.load;

    const emailTab = createEmailTab({ user });
    tabs.email = emailTab.el;
    tabLoaders.email = emailTab.load;

    const integrationsTab = createIntegrationsTab({ user });
    tabs.integrations = integrationsTab.el;
    tabLoaders.integrations = integrationsTab.load;

    const analyticsTab = createAnalyticsTab({ user });
    tabs.analytics = analyticsTab.el;
    tabLoaders.analytics = analyticsTab.load;
  }

  // Current active tab
  let activeTab = initialTab;

  // Set active tab
  const setActiveTab = (tabKey) => {
    // Guard designer tabs
    if (DESIGNER_TABS.includes(tabKey) && !isDesigner) {
      tabKey = DEFAULT_TAB;
    }
    // Guard admin tabs
    if (ADMIN_TABS.includes(tabKey) && !isAdmin) {
      tabKey = DEFAULT_TAB;
    }

    activeTab = tabKey;
    setTabHash(tabKey);
    sidebar.setActiveTab(tabKey);

    // Update tab visibility
    for (const [key, el] of Object.entries(tabs)) {
      el.classList.toggle('is-active', key === tabKey);
    }

    // Lazy load tab data
    const loader = tabLoaders[tabKey];
    if (loader) loader();
  };

  // Sidebar
  const sidebar = createSettingsSidebar({
    isAdmin,
    isDesigner,
    activeTab: initialTab,
    onTabChange: setActiveTab,
  });
  shell.append(sidebar.el);

  // Content area
  const content = h('main', {
    class: 'settings-content',
    role: 'main',
    id: 'settings-main-content',
  });

  // Add all tab containers
  for (const el of Object.values(tabs)) {
    content.append(el);
  }

  shell.append(content);
  root.append(shell);

  // Set initial active tab (triggers load)
  setActiveTab(initialTab);

  // Handle hash changes
  const handleHashChange = () => {
    const newTab = getTabFromHash(isAdmin, isDesigner);
    if (newTab !== activeTab) {
      setActiveTab(newTab);
    }
  };
  window.addEventListener('hashchange', handleHashChange);

  // Cleanup
  return () => {
    window.removeEventListener('hashchange', handleHashChange);
  };
}