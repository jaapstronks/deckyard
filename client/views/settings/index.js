/**
 * Settings Page
 * Main settings page with tabbed navigation
 */

import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { createSettingsSidebar } from './settings-sidebar.js';
import {
  isOrganizationAdmin,
  canSeeMemberList,
  isOrganizationMember,
} from '../../../shared/organization-role.js';
import { reachableTabs, resolveTab } from './tab-registry.js';
import { nav, replaceHash } from '../../lib/state/router.js';
import { icon } from '../../lib/dom/icons.js';
import { debugLog } from '../../lib/state/debug.js';

/**
 * The tab named in the URL hash, or the default when this viewer may not
 * reach it.
 * @param {import('./tab-registry.js').SettingsAccess} access
 * @returns {string} Tab key
 */
function getTabFromHash(access) {
  return resolveTab(location.hash.slice(1), access);
}

/**
 * Set the URL hash without triggering navigation.
 * @param {string} tab - Tab key
 */
function setTabHash(tab) {
  replaceHash(tab);
}

/**
 * Render the settings page.
 * @param {HTMLElement} root - Root element
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Function|null} Cleanup function
 */
export async function renderSettings(root, { user } = {}) {
  // Admin tabs follow the role held in the *active* organization, not the
  // instance-wide flag: switching to an organization where you are a plain
  // member must take the admin surfaces with it. See shared/organization-role.js.
  const access = {
    isAdmin: isOrganizationAdmin(user),
    // eslint-disable-next-line no-restricted-syntax -- Installation routes use the instance-wide flag even for a member of the active organization.
    isInstanceAdmin: Boolean(user?.isAdmin),
    isDesigner: Boolean(user?.isDesigner),
    // Wider than `isAdmin` on purpose; see tab-registry.js.
    canSeeMembers: canSeeMemberList(user),
    canSeeOrganization: isOrganizationMember(user),
  };
  const initialTab = getTabFromHash(access);

  const shell = h('div', { class: 'app-shell settings-page' });

  // Topbar
  const topbar = h('header', {
    class: 'topbar settings-topbar',
    role: 'banner',
  });
  const backBtn = h('button', {
    class: 'btn btn-secondary btn-icon',
    'aria-label': t('common.back', 'Back'),
    title: t('common.back', 'Back'),
    onclick: () => nav('/app'),
  });
  backBtn.append(icon('arrow-left'));

  const topbarTitle = h('div', { class: 'topbar-title' });
  topbarTitle.append(
    h('h1', {
      class: 'settings-page-title',
      text: t('settings.title', 'Settings'),
    }),
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
    if (tab.detach) tabDestroyers.push(tab.detach);
  };

  for (const tab of reachableTabs(access)) {
    addTab(tab.key, tab.create({ user }));
  }

  // Current active tab
  let activeTab = initialTab;

  // Set active tab
  const setActiveTab = (tabKey) => {
    tabKey = resolveTab(tabKey, access);
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
    ...access,
    organizationId: user?.organizationId,
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
    const newTab = getTabFromHash(access);
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
      } catch (err) {
        debugLog('Settings tab teardown failed', err);
      }
    }
  };
}
