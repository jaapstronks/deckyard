/**
 * Settings Page
 *
 * One section on screen at a time, addressed by the URL hash (B805): a
 * sidebar link pushes a history entry, Back/Forward/reload restore the
 * section, and an unknown or unreachable hash is replaced by the default in
 * one place (`resolveTab`). A switch away from a form with unsaved changes
 * asks first.
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
import {
  nav,
  pushHash,
  replaceHash,
  currentHash,
} from '../../lib/state/router.js';
import { icon } from '../../lib/dom/icons.js';
import { confirmModal } from '../../lib/dom/modal.js';
import { debugLog } from '../../lib/state/debug.js';

/**
 * Ask before dropping unsaved edits. Resolves true when there are none or the
 * user chose to discard them.
 * @returns {Promise<boolean>}
 */
function confirmDiscard() {
  return confirmModal(document.body, {
    title: t('settings.unsaved.title', 'Discard unsaved changes?'),
    message: t(
      'settings.unsaved.message',
      'This section has changes that are not saved yet. Leaving it discards them.',
    ),
    confirmLabel: t('common.discardChanges', 'Discard changes'),
    cancelLabel: t('common.keepEditing', 'Keep editing'),
    danger: true,
  });
}

/**
 * Move focus to the heading of a section that was just navigated to, so a
 * keyboard or screen-reader user lands where the content starts.
 * @param {HTMLElement} view
 */
function focusSectionHeading(view) {
  const heading = view.querySelector('h2') || view;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: false });
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
  const initialTab = resolveTab(currentHash(), access);

  const shell = h('div', { class: 'app-shell settings-page' });

  // Topbar. The arrow leads to the overview and says so: it is a link to
  // /app, not the browser's Back, which now walks through the sections.
  const topbar = h('header', {
    class: 'topbar settings-topbar',
    role: 'banner',
  });
  const overviewLink = h(
    'a',
    {
      class: 'btn btn-secondary settings-overview-link',
      href: '/app',
      onclick: async (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        if (await mayLeaveSection()) nav('/app');
      },
    },
    [
      icon('arrow-left'),
      h('span', { text: t('settings.overview', 'Overview') }),
    ],
  );

  const topbarTitle = h('div', { class: 'topbar-title' });
  topbarTitle.append(
    h('h1', {
      class: 'settings-page-title',
      text: t('settings.title', 'Settings'),
    }),
  );

  topbar.append(overviewLink, topbarTitle);
  shell.append(topbar);

  // Create tabs
  const tabs = {};
  const tabLoaders = {};
  const tabDestroyers = [];
  const tabGuards = {};

  /**
   * Register a tab. Going through one seam means a tab that owns a timer or a
   * stream (the export tab polls a job every 2s and holds a notification
   * EventSource) can hand back a `detach` and be sure it runs on unmount —
   * these used to run for the lifetime of the browser tab. A tab with
   * explicit-Save forms hands back `hasUnsavedChanges` and `discardChanges`.
   * @param {string} key - Tab key (matches the URL hash)
   * @param {{el: HTMLElement, load?: Function, detach?: Function, hasUnsavedChanges?: () => boolean, discardChanges?: () => void}} tab
   */
  const addTab = (key, tab) => {
    tabs[key] = tab.el;
    if (tab.load) tabLoaders[key] = tab.load;
    if (tab.detach) tabDestroyers.push(tab.detach);
    if (tab.hasUnsavedChanges) tabGuards[key] = tab;
  };

  for (const tab of reachableTabs(access)) {
    addTab(tab.key, tab.create({ user }));
  }

  // Current active tab
  let activeTab = initialTab;

  /**
   * Whether the section on screen may be left: true when it holds no unsaved
   * edits or the user chose to discard them (which restores the saved state).
   * @returns {Promise<boolean>}
   */
  async function mayLeaveSection() {
    const guard = tabGuards[activeTab];
    if (!guard?.hasUnsavedChanges()) return true;
    if (!(await confirmDiscard())) return false;
    guard.discardChanges?.();
    return true;
  }

  /**
   * Show a section. The caller has already settled the URL.
   * @param {string} tabKey - A resolved key
   * @param {{ focus?: boolean }} [opts]
   */
  const showTab = (tabKey, { focus = false } = {}) => {
    activeTab = tabKey;
    sidebar.setActiveTab(tabKey);

    // Update tab visibility
    for (const [key, el] of Object.entries(tabs)) {
      el.classList.toggle('is-active', key === tabKey);
    }

    // Lazy load tab data
    const loader = tabLoaders[tabKey];
    if (loader) loader();
    if (focus && tabs[tabKey]) focusSectionHeading(tabs[tabKey]);
  };

  /**
   * A sidebar link was followed: ask about unsaved edits, then push the
   * section as a history entry.
   * @param {string} requested
   */
  const navigateTo = async (requested) => {
    const tabKey = resolveTab(requested, access);
    sidebar.close();
    if (tabKey === activeTab) {
      focusSectionHeading(tabs[tabKey]);
      return;
    }
    if (!(await mayLeaveSection())) return;
    pushHash(tabKey);
    showTab(tabKey, { focus: true });
  };

  // Sidebar
  const sidebar = createSettingsSidebar({
    ...access,
    organizationId: user?.organizationId,
    activeTab: initialTab,
    onNavigate: navigateTo,
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

  // `/settings` and an unknown or unreachable hash land on the default,
  // corrected in place rather than as a new history entry.
  replaceHash(initialTab);
  showTab(initialTab);

  // Back/Forward and a hand-edited hash. The router leaves hash-only history
  // steps to this listener, so the page (and its unsaved edits) survives.
  let restoring = false;
  const handleHashChange = async () => {
    if (restoring) return;
    const requested = currentHash();
    const tabKey = resolveTab(requested, access);
    if (tabKey === activeTab) {
      if (requested !== tabKey) replaceHash(tabKey);
      return;
    }
    restoring = true;
    try {
      if (!(await mayLeaveSection())) {
        // The address already moved; put it back on the section that kept
        // its edits.
        replaceHash(activeTab);
        return;
      }
      if (requested !== tabKey) replaceHash(tabKey);
      showTab(tabKey, { focus: true });
    } finally {
      restoring = false;
    }
  };
  window.addEventListener('hashchange', handleHashChange);

  // Cleanup
  return () => {
    window.removeEventListener('hashchange', handleHashChange);
    sidebar.detach();
    for (const destroy of tabDestroyers) {
      try {
        destroy();
      } catch (err) {
        debugLog('Settings tab teardown failed', err);
      }
    }
  };
}
