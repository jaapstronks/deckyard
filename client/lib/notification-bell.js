/**
 * Notification bell component with real-time updates via SSE.
 * Shows unread count badge and dropdown with notification list.
 */

import { h, installDismissOnOutside } from './dom.js';
import { t } from './ui-i18n.js';
import { createAvatar } from './avatar.js';
import { getUserProfile, prefetchProfiles } from './user-profiles.js';

/**
 * Accessible label for a notification list item. Each shape is one full
 * translatable sentence so translations control order and punctuation.
 * @param {Object} notif - Notification record
 * @returns {string} aria-label text
 */
function notificationLabel(notif) {
  const title = notif.title || '';
  const body = notif.body || '';
  if (body && !notif.isRead) {
    return t('notifications.label.bodyUnread', '{title}: {body} (unread)', { title, body });
  }
  if (body) return t('notifications.label.body', '{title}: {body}', { title, body });
  if (!notif.isRead) return t('notifications.label.unread', '{title} (unread)', { title });
  return title;
}

/**
 * Create a notification bell component.
 * @param {Object} options
 * @param {Function} options.api - API call function
 * @param {Function} [options.onNavigate] - Callback to navigate to a URL
 * @returns {Object} { el, detach }
 */
export function createNotificationBell({ api, onNavigate }) {
  let isOpen = false;
  let notifications = [];
  let unreadCount = 0;
  let isLoading = false;
  let eventSource = null;
  // Events-inbox lens: 'all' (default, unarchived), 'mentions', 'unread',
  // 'archived'. Archiving = "handled"; is_read stays "seen" (badge).
  let filter = 'all';

  // Container
  const container = h('div', { class: 'notification-bell' });

  // Bell button
  const bellBtn = h('button', {
    class: 'notification-bell-btn',
    type: 'button',
    'aria-label': t('notifications.bell', 'Notifications'),
    'aria-expanded': 'false',
    'aria-haspopup': 'true',
    title: t('notifications.bell', 'Notifications'),
  });

  // Bell icon (SVG)
  const bellIcon = h(
    'svg',
    {
      class: 'notification-bell-icon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    [
      h('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
      h('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }),
    ]
  );

  // Badge for unread count
  const badge = h('span', { class: 'notification-bell-badge' });

  bellBtn.append(bellIcon, badge);

  // Dropdown panel
  const dropdown = h('div', { class: 'notification-bell-dropdown' });

  // Dropdown header
  const dropdownHeader = h('div', { class: 'notification-bell-header' }, [
    h('span', { class: 'notification-bell-title', text: t('notifications.title', 'Notifications') }),
  ]);

  const markAllReadBtn = h('button', {
    class: 'notification-bell-mark-all',
    type: 'button',
    text: t('notifications.markAllRead', 'Mark all read'),
    onclick: async (e) => {
      e.stopPropagation();
      await markAllAsRead();
    },
  });

  const archiveAllBtn = h('button', {
    class: 'notification-bell-mark-all',
    type: 'button',
    text: t('notifications.archiveAll', 'Archive all'),
    onclick: async (e) => {
      e.stopPropagation();
      await archiveAll();
    },
  });

  dropdownHeader.append(archiveAllBtn, markAllReadBtn);

  // Filter chips (events-inbox lenses)
  const FILTERS = [
    { value: 'all', label: () => t('notifications.filter.all', 'All') },
    { value: 'mentions', label: () => t('notifications.filter.mentions', 'Mentions') },
    { value: 'unread', label: () => t('notifications.filter.unread', 'Unread') },
    { value: 'archived', label: () => t('notifications.filter.archived', 'Archived') },
  ];
  const filterBtns = FILTERS.map((f) => {
    const btn = h('button', {
      class: 'notification-bell-filter-btn',
      type: 'button',
      text: f.label(),
      'aria-pressed': String(f.value === filter),
      onclick: (e) => {
        e.stopPropagation();
        if (filter === f.value) return;
        filter = f.value;
        syncFilterUi();
        loadNotifications();
      },
    });
    btn.dataset.filter = f.value;
    return btn;
  });
  const filterRow = h('div', { class: 'notification-bell-filters' }, filterBtns);

  function syncFilterUi() {
    for (const btn of filterBtns) {
      const active = btn.dataset.filter === filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    // Only on the All lens: there the visible list is exactly what
    // {all:true} archives. On a narrowed lens the button would silently
    // archive items outside the current view.
    archiveAllBtn.style.display = filter === 'all' ? '' : 'none';
  }
  syncFilterUi();

  // Notification list
  const listContainer = h('div', { class: 'notification-bell-list' });

  dropdown.append(dropdownHeader, filterRow, listContainer);
  container.append(bellBtn, dropdown);

  // Install dismiss handler
  const detachDismiss = installDismissOnOutside({
    rootEl: container,
    isOpen: () => isOpen,
    close: () => closeDropdown(),
    returnFocusEl: bellBtn,
  });

  function updateBadge() {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.classList.add('is-visible');
      bellBtn.classList.add('has-unread');
    } else {
      badge.textContent = '';
      badge.classList.remove('is-visible');
      bellBtn.classList.remove('has-unread');
    }
    markAllReadBtn.style.display = unreadCount > 0 ? '' : 'none';
  }

  function renderNotifications() {
    listContainer.innerHTML = '';

    if (isLoading) {
      listContainer.append(
        h('div', {
          class: 'notification-bell-item is-loading',
          text: t('notifications.loading', 'Loading...'),
        })
      );
      return;
    }

    if (notifications.length === 0) {
      listContainer.append(
        h('div', {
          class: 'notification-bell-item is-empty',
          text: filter === 'archived'
            ? t('notifications.empty.archived', 'Nothing archived yet')
            : t('notifications.empty', 'No notifications'),
        })
      );
      return;
    }

    for (const notif of notifications) {
      const item = h('button', {
        type: 'button',
        class: `notification-bell-item${notif.isRead ? '' : ' is-unread'}`,
        onclick: () => handleNotificationClick(notif),
        'aria-label': notificationLabel(notif),
      });

      // Actor avatar with profile image support
      const actorEmail = notif.actorEmail || '';
      const actorName = notif.actorName || '';
      const profile = actorEmail ? getUserProfile(actorEmail) : null;

      const avatar = createAvatar({
        imageUrl: profile?.imageUrl || '',
        email: actorEmail,
        name: profile?.name || actorName,
        size: 'md',
        className: 'notification-bell-avatar',
      });

      // Content
      const content = h('div', { class: 'notification-bell-content' });
      const title = h('div', { class: 'notification-bell-item-title', text: notif.title });
      content.append(title);

      if (notif.body) {
        const body = h('div', { class: 'notification-bell-item-body', text: notif.body });
        content.append(body);
      }

      // Timestamp
      const timeAgo = formatTimeAgo(notif.createdAt);
      const time = h('div', { class: 'notification-bell-item-time', text: timeAgo });
      content.append(time);

      item.append(avatar, content);

      // Unread indicator
      if (!notif.isRead) {
        const unreadDot = h('div', { class: 'notification-bell-unread-dot', 'aria-hidden': 'true' });
        item.append(unreadDot);
      }

      // Archive ("handled") - not shown on already-archived items. A row
      // wrapper keeps the item itself a button for click-to-navigate.
      const row = h('div', { class: 'notification-bell-row' });
      row.append(item);
      if (!notif.archivedAt) {
        const archiveBtn = h('button', {
          type: 'button',
          class: 'notification-bell-archive-btn',
          title: t('notifications.archive', 'Archive'),
          'aria-label': t('notifications.archive', 'Archive'),
          text: '✓',
          onclick: (e) => {
            e.stopPropagation();
            archiveOne(notif);
          },
        });
        row.append(archiveBtn);
      }

      listContainer.append(row);
    }
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return t('list.time.justNow', 'just now');
    if (diffMin < 60) return t('list.time.minutesAgo', '{count} min ago', { count: diffMin });
    if (diffHour < 24) return t('list.time.hoursAgo', '{count}h ago', { count: diffHour });
    if (diffDay < 7) return t('list.time.daysAgo', '{count}d ago', { count: diffDay });

    return date.toLocaleDateString();
  }

  function openDropdown() {
    if (isOpen) return;
    isOpen = true;
    dropdown.classList.add('is-open');
    bellBtn.setAttribute('aria-expanded', 'true');
    loadNotifications();
  }

  function closeDropdown() {
    if (!isOpen) return;
    isOpen = false;
    dropdown.classList.remove('is-open');
    bellBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleDropdown() {
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  async function loadNotifications() {
    isLoading = true;
    renderNotifications();

    try {
      const resp = await api(`/api/notifications?limit=20&filter=${encodeURIComponent(filter)}`);
      notifications = resp?.notifications || [];
      unreadCount = resp?.unreadCount || 0;
      updateBadge();

      // Prefetch profiles for all notification actors
      const emails = notifications
        .map((n) => n.actorEmail)
        .filter(Boolean);
      if (emails.length) {
        prefetchProfiles(emails);
      }
    } catch (e) {
      notifications = [];
      // eslint-disable-next-line no-console
      console.error('[notification-bell] load error:', e);
    } finally {
      isLoading = false;
      renderNotifications();
    }
  }

  async function fetchUnreadCount() {
    try {
      const resp = await api('/api/notifications/unread-count');
      unreadCount = resp?.unreadCount || 0;
      updateBadge();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notification-bell] unread count error:', e);
    }
  }

  async function markAsRead(notificationId) {
    try {
      await api('/api/notifications/mark-read', {
        method: 'POST',
        body: JSON.stringify({ notificationId }),
      });

      // Update local state
      const notif = notifications.find((n) => n.id === notificationId);
      if (notif && !notif.isRead) {
        notif.isRead = true;
        unreadCount = Math.max(0, unreadCount - 1);
        updateBadge();
        renderNotifications();
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notification-bell] mark read error:', e);
    }
  }

  async function markAllAsRead() {
    try {
      await api('/api/notifications/mark-read', {
        method: 'POST',
        body: JSON.stringify({ all: true }),
      });

      // Update local state
      for (const notif of notifications) {
        notif.isRead = true;
      }
      unreadCount = 0;
      updateBadge();
      renderNotifications();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notification-bell] mark all read error:', e);
    }
  }

  async function archiveOne(notif) {
    try {
      await api('/api/notifications/archive', {
        method: 'POST',
        body: JSON.stringify({ notificationId: notif.id }),
      });
      // Archived items leave every non-archived lens; archiving also reads.
      if (!notif.isRead) {
        unreadCount = Math.max(0, unreadCount - 1);
        updateBadge();
      }
      notif.isRead = true;
      notif.archivedAt = new Date().toISOString();
      if (filter !== 'archived') {
        notifications = notifications.filter((n) => n.id !== notif.id);
      }
      renderNotifications();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notification-bell] archive error:', e);
    }
  }

  async function archiveAll() {
    try {
      await api('/api/notifications/archive', {
        method: 'POST',
        body: JSON.stringify({ all: true }),
      });
      notifications = []; // Button only renders on the All lens
      unreadCount = 0;
      updateBadge();
      renderNotifications();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notification-bell] archive all error:', e);
    }
  }

  async function handleNotificationClick(notif) {
    // Mark as read
    if (!notif.isRead) {
      markAsRead(notif.id);
    }

    // Navigate to action URL
    if (notif.actionUrl) {
      closeDropdown();
      if (onNavigate) {
        // Extract relative path from actionUrl, keeping the query string
        // (comment notifications anchor to a slide via ?slideId=).
        try {
          const url = new URL(notif.actionUrl, window.location.origin);
          onNavigate(url.pathname + url.search);
        } catch {
          onNavigate(notif.actionUrl);
        }
      } else {
        window.location.href = notif.actionUrl;
      }
    } else if (notif.presentationId) {
      closeDropdown();
      const path = `/app/${notif.presentationId}`;
      if (onNavigate) {
        onNavigate(path);
      } else {
        window.location.href = path;
      }
    }
  }

  function connectSSE() {
    if (eventSource) {
      eventSource.close();
    }

    try {
      eventSource = new EventSource('/api/notifications/events');

      eventSource.addEventListener('connected', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (typeof data.unreadCount === 'number') {
            unreadCount = data.unreadCount;
            updateBadge();
          }
        } catch {
          // ignore parse errors
        }
      });

      eventSource.addEventListener('notification:new', (e) => {
        try {
          const notif = JSON.parse(e.data);
          // Add to the list when it belongs in the current lens (a new
          // item is never archived; mentions lens wants mentions only).
          const belongs = filter === 'all'
            || filter === 'unread'
            || (filter === 'mentions' && notif.notificationType === 'comment_mention');
          // Coalesced bundles (e.g. deck_activity) re-send the SAME id with a
          // bumped count. Replace the existing row and move it to the top
          // instead of adding a duplicate, and don't re-increment the badge —
          // an authoritative notification:counts follows for those.
          const existingIdx = notifications.findIndex((n) => n.id === notif.id);
          if (existingIdx !== -1) {
            notifications.splice(existingIdx, 1);
            if (belongs) notifications.unshift(notif);
          } else {
            if (belongs) notifications.unshift(notif);
            unreadCount++;
            updateBadge();
          }
          if (isOpen) {
            renderNotifications();
          }
        } catch {
          // ignore parse errors
        }
      });

      eventSource.addEventListener('notification:counts', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (typeof data.unreadCount === 'number') {
            unreadCount = data.unreadCount;
            updateBadge();
          }
        } catch {
          // ignore parse errors
        }
      });

      eventSource.onerror = () => {
        // Reconnect after a delay
        eventSource?.close();
        eventSource = null;
        setTimeout(connectSSE, 5000);
      };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[notification-bell] SSE connection error:', e);
    }
  }

  // Event handlers
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Initialize
  fetchUnreadCount();
  connectSSE();

  return {
    el: container,
    refresh: () => {
      fetchUnreadCount();
      if (isOpen) {
        loadNotifications();
      }
    },
    detach: () => {
      detachDismiss();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    },
  };
}