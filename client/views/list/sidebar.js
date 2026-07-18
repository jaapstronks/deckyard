/**
 * Sidebar navigation component for the overview page.
 * PowerPoint-style sidebar with navigation items.
 */

import { t } from '../../lib/ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * Sidebar view configuration.
 */
export const SIDEBAR_VIEWS = [
  { key: 'home', icon: 'house', label: () => t('list.nav.home', 'Home') },
  { key: 'recent', icon: 'clock', label: () => t('list.nav.recent', 'Recent') },
  { key: 'workspace', icon: 'users', label: () => t('list.nav.workspace', 'Workspace') },
  { key: 'myPresentations', icon: 'file-text', label: () => t('list.nav.myPresentations', 'My presentations') },
  { key: 'sharedWithMe', icon: 'share-2', label: () => t('list.nav.sharedWithMe', 'Shared with me') },
  { key: 'slideLibrary', icon: 'book-open', label: () => t('list.nav.slideLibrary', 'Slide library') },
  { key: 'insights', icon: 'chart-column', label: () => t('list.nav.insights', 'Insights'), action: true, href: '/insights' },
  { key: 'activity', icon: 'newspaper', label: () => t('list.nav.activity', 'Activity'), badge: true },
  { key: 'trash', icon: 'trash-2', label: () => t('list.nav.trash', 'Trash') },
];

/**
 * Create the sidebar navigation component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper function
 * @param {string} options.activeView - Currently active view key
 * @param {Function} options.onViewChange - Callback when view changes
 * @param {Function} options.onAction - Callback when an action item is clicked (key) => void
 * @param {Function} options.onNewClick - Callback when New button is clicked
 * @param {number} options.unreadCount - Unread activity count
 * @returns {Object} { el, updateBadge, setActiveView }
 */
export function createSidebar({ h, activeView = 'home', onViewChange, onAction, onNewClick, unreadCount = 0 }) {
  const el = h('aside', { class: 'app-sidebar', role: 'navigation', 'aria-label': t('list.nav.aria', 'Main navigation') });

  // New presentation button at top
  const newBtn = h('button', {
    class: 'sidebar-new-btn',
    type: 'button',
    onclick: () => onNewClick?.(),
  });
  newBtn.append(
    h('span', { class: 'sidebar-new-icon', text: '+' }),
    h('span', { text: t('list.new', 'New') })
  );
  el.append(newBtn);

  const nav = h('nav', { class: 'sidebar-nav' });

  const items = new Map();
  let badgeEl = null;

  // Build navigation items
  for (const view of SIDEBAR_VIEWS) {
    const item = h('button', {
      class: `sidebar-nav-item${activeView === view.key && !view.action ? ' is-active' : ''}`,
      type: 'button',
      'data-view': view.key,
      onclick: () => {
        if (view.action) {
          if (view.href) {
            // Navigate to external route
            if (onAction) onAction(view.key, view.href);
          } else {
            if (onAction) onAction(view.key);
          }
        } else {
          if (onViewChange) onViewChange(view.key);
        }
      },
    });

    const icon = h('img', { class: 'sidebar-nav-icon', src: iconUrl(view.icon), alt: '', 'aria-hidden': 'true' });
    const label = h('span', { class: 'sidebar-nav-text', text: view.label() });
    item.append(icon, label);

    // Add badge for activity view
    if (view.badge) {
      badgeEl = h('span', {
        class: 'sidebar-nav-badge',
        text: unreadCount > 0 ? String(unreadCount) : '',
        'data-count': String(unreadCount),
      });
      item.append(badgeEl);
    }

    items.set(view.key, item);
    nav.append(item);
  }

  el.append(nav);

  return {
    el,

    /**
     * Update the unread badge count.
     */
    updateBadge(count) {
      if (badgeEl) {
        badgeEl.textContent = count > 0 ? String(count) : '';
        badgeEl.dataset.count = String(count);
      }
    },

    /**
     * Set the active view.
     */
    setActiveView(viewKey) {
      for (const [key, item] of items) {
        item.classList.toggle('is-active', key === viewKey);
      }
    },
  };
}

/**
 * Create the mobile bottom tab bar component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper function
 * @param {string} options.activeView - Currently active view key
 * @param {Function} options.onViewChange - Callback when view changes
 * @param {number} options.unreadCount - Unread activity count
 * @returns {Object} { el, updateBadge, setActiveView }
 */
export function createBottomTabs({ h, activeView = 'home', onViewChange, unreadCount = 0 }) {
  const el = h('nav', { class: 'app-bottom-tabs' });
  const inner = h('div', { class: 'app-bottom-tabs-inner' });

  const items = new Map();
  let badgeEl = null;

  // Build tab items (subset for mobile - home, recent, workspace, slideLibrary, activity)
  const mobileViews = SIDEBAR_VIEWS.filter(v =>
    ['home', 'recent', 'workspace', 'slideLibrary', 'activity'].includes(v.key)
  );

  for (const view of mobileViews) {
    const tab = h('button', {
      class: `bottom-tab${activeView === view.key ? ' is-active' : ''}`,
      type: 'button',
      'data-view': view.key,
      onclick: () => {
        if (onViewChange) onViewChange(view.key);
      },
    });

    const icon = h('img', { class: 'bottom-tab-icon', src: iconUrl(view.icon), alt: '', 'aria-hidden': 'true' });
    const label = h('span', { class: 'bottom-tab-label', text: view.label() });
    tab.append(icon, label);

    // Add badge for activity view
    if (view.badge) {
      badgeEl = h('span', {
        class: 'bottom-tab-badge',
        text: unreadCount > 0 ? String(unreadCount) : '',
        'data-count': String(unreadCount),
      });
      tab.append(badgeEl);
    }

    items.set(view.key, tab);
    inner.append(tab);
  }

  el.append(inner);

  return {
    el,

    /**
     * Update the unread badge count.
     */
    updateBadge(count) {
      if (badgeEl) {
        badgeEl.textContent = count > 0 ? String(count) : '';
        badgeEl.dataset.count = String(count);
      }
    },

    /**
     * Set the active view.
     */
    setActiveView(viewKey) {
      for (const [key, item] of items) {
        item.classList.toggle('is-active', key === viewKey);
      }
    },
  };
}