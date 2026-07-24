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
  const tabDestroyers = [];

  /**
   * Register a tab. Going through one seam means a tab that owns a timer or a
   * stream (the export tab polls a job every 2s and holds a notification
   * EventSource) can hand back a `destroy` and be sure it runs on unmount —
   * these used to run for the lifetime of the browser tab.
   * @param {string} key - Tab key (matches the URL hash)
   * @param {{el: HTMLElement, load?: Function, destroy?: Function}} tab
   */
  const addTab = (key, tab) => {
    tabs[key] = tab.el;
    if (tab.load) tabLoaders[key] = tab.load;
    if (tab.destroy) tabDestroyers.push(tab.destroy);
  };

  // Always visible
  addTab('account', createAccountTab({ user }));
  addTab('preferences', createPreferencesTab({ user, nav }));
  addTab('export', createExportTab({ user }));

  // Designer tabs
  if (isDesigner) {
    addTab('fonts', createFontsTab({ user }));
    addTab('themes', createThemesTab({ user }));
    addTab('slide-types', createSlideTypesTab({ user }));
  }

  // Admin tabs
  if (isAdmin) {
    addTab('admin', createAdminTab({ user }));
    addTab('users', createUsersTab({ user }));
    addTab('api-keys', createApiKeysTab({ user }));
    addTab('email', createEmailTab({ user }));
    addTab('integrations', createIntegrationsTab({ user }));
    addTab('analytics', createAnalyticsTab({ user }));
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
    for (const destroy of tabDestroyers) {
      try {
        destroy();
      } catch {
        // a failing tab teardown must not block the rest
      }
    }
  };
}