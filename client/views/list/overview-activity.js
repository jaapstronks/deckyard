/**
 * Activity feed view component.
 * Displays workspace activity events.
 */

import { t } from '../../lib/ui-i18n.js';
import { formatRelativeTime as _formatRelativeTime } from '../../lib/format-time.js';
import { iconUrl } from '../../../shared/icon-names.js';

/** Wrap shared formatter to pass `t` automatically. */
function formatRelativeTime(date) {
  return _formatRelativeTime(date, t);
}

/**
 * Get initials from a name or email.
 * @param {string} name - Name or email
 * @returns {string} Initials (2 chars max)
 */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.split(/[@\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

/**
 * Get action text for an event type.
 * @param {string} eventType - Event type
 * @returns {string} Action text
 */
function getActionText(eventType) {
  const actions = {
    'presentation.created': t('activity.action.created', 'created'),
    'presentation.updated': t('activity.action.updated', 'updated'),
    'presentation.merged': t('activity.action.mergedChangesOn', 'merged concurrent changes in'),
    'presentation.deleted': t('activity.action.deleted', 'deleted'),
    'presentation.moved_to_workspace': t('activity.action.sharedToWorkspace', 'shared to workspace'),
    'collaborator.added': t('activity.action.sharedWith', 'shared'),
    'comment.created': t('activity.action.commentedOn', 'commented on'),
    'comment.resolved': t('activity.action.resolvedCommentOn', 'resolved a comment on'),
    'comment.reopened': t('activity.action.reopenedCommentOn', 'reopened a comment on'),
    'share.accessed': t('activity.action.viewed', 'viewed'),
    // slide.added carries a count, handled separately in createActivityItem.
    'slide.added': t('activity.action.addedSlidesTo', 'added slides to'),
  };
  return actions[eventType] || t('activity.action.updated', 'updated');
}

/**
 * Append a translated sentence to `parent`, substituting `{name}` placeholders
 * with DOM nodes so the whole sentence stays one translatable key (word order
 * and punctuation are decided by the translation, not by JS concatenation).
 * @param {HTMLElement} parent - Element to append into
 * @param {Function} h - DOM helper function
 * @param {string} template - Translated string containing {name} placeholders
 * @param {Object<string, Node>} slots - Nodes keyed by placeholder name
 * @param {string} textClass - Class for the literal text fragments
 * @returns {void}
 */
function appendSentence(parent, h, template, slots, textClass) {
  const parts = String(template).split(/(\{[a-zA-Z0-9_]+\})/g);
  for (const part of parts) {
    if (!part) continue;
    const name = /^\{([a-zA-Z0-9_]+)\}$/.exec(part)?.[1];
    if (name && slots[name]) {
      parent.append(slots[name]);
    } else {
      parent.append(h('span', { class: textClass, text: part }));
    }
  }
}

/**
 * Get icon class for event type.
 * @param {string} eventType - Event type
 * @returns {string} Icon class
 */
function getEventTypeClass(eventType) {
  if (eventType.startsWith('comment.')) return 'is-comment';
  if (eventType.includes('resolved')) return 'is-resolved';
  if (eventType.startsWith('collaborator.')) return 'is-share';
  return 'is-presentation';
}

/**
 * Get Lucide icon name for event type.
 * @param {string} eventType - Event type
 * @returns {string} Lucide icon name
 */
function getEventIcon(eventType) {
  const icons = {
    'presentation.created': 'plus',
    'presentation.updated': 'pencil',
    'presentation.merged': 'git-merge',
    'presentation.deleted': 'trash-2',
    'presentation.moved_to_workspace': 'users',
    'collaborator.added': 'handshake',
    'comment.created': 'message-circle',
    'comment.resolved': 'circle-check',
    'comment.reopened': 'refresh-cw',
    'share.accessed': 'eye',
    'slide.added': 'layers',
  };
  return icons[eventType] || 'file-text';
}

/**
 * Create a single activity item element.
 * @param {Object} event - Activity event
 * @param {Function} h - DOM helper function
 * @param {Function} onNavigate - Navigation callback
 * @returns {HTMLElement} Activity item element
 */
function createActivityItem(event, h, onNavigate) {
  const item = h('div', { class: 'activity-item' });

  // Avatar
  const avatar = h('div', {
    class: `activity-avatar${event.actorType === 'guest' ? ' is-guest' : ''}`,
    text: getInitials(event.actorName || event.actorEmail),
  });

  // Content
  const content = h('div', { class: 'activity-content' });

  // Header with actor, action, and target
  const header = h('div', { class: 'activity-header' });

  // Event type icon
  const typeIcon = h('img', {
    class: `activity-type-icon ${getEventTypeClass(event.eventType)}`,
    src: iconUrl(getEventIcon(event.eventType)),
    alt: '',
    'aria-hidden': 'true',
  });

  const actor = h('span', {
    class: 'activity-actor',
    text: event.actorName || event.actorEmail || t('activity.someone', 'Someone'),
  });

  // slide.added carries a slide count in its data ("added 3 slides to X"); all
  // other types use the static action map.
  const actionText = event.eventType === 'slide.added'
    ? t('activity.action.addedNSlidesTo', 'added {count} slides to', {
        count: Number(event.data?.count) || 1,
      })
    : getActionText(event.eventType);

  const action = h('span', {
    class: 'activity-action',
    text: ' ' + actionText + ' ',
  });

  const presentationTitle = event.presentation?.title ||
    event.data?.title ||
    event.data?.presentationTitle ||
    t('activity.untitled', 'Untitled');

  const target = h('a', {
    class: 'activity-target',
    href: event.presentationId ? `/app/${event.presentationId}` : '#',
    text: `"${presentationTitle}"`,
    onclick: (e) => {
      e.preventDefault();
      if (event.presentationId && onNavigate) {
        onNavigate(`/app/${event.presentationId}`);
      }
    },
  });

  header.append(typeIcon, actor, action, target);

  // For collaborator.added events, show who it was shared with
  if (event.eventType === 'collaborator.added' && event.data?.collaboratorEmail) {
    const collaborator = h('span', {
      class: 'activity-collaborator',
      text: event.data.collaboratorEmail,
    });
    header.append(' ');
    appendSentence(
      header,
      h,
      t('activity.sharedWithCollaborator', 'with {collaborator}'),
      { collaborator },
      'activity-action'
    );
  }

  content.append(header);

  // Preview for comments
  if (event.eventType === 'comment.created' && event.data?.bodyPreview) {
    const preview = h('div', {
      class: 'activity-preview',
      text: `"${event.data.bodyPreview}"`,
    });
    content.append(preview);
  }

  // Time
  const time = h('div', {
    class: 'activity-time',
    text: formatRelativeTime(event.createdAt),
    title: new Date(event.createdAt).toLocaleString(),
  });

  item.append(avatar, content, time);

  // Click handler for the whole item
  item.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') return; // Don't double-handle link clicks
    if (event.presentationId && onNavigate) {
      onNavigate(`/app/${event.presentationId}`);
    }
  });

  return item;
}

/**
 * Create the activity feed view component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper function
 * @param {Function} options.api - API function
 * @param {Function} options.onNavigate - Navigation callback
 * @param {Function} options.onUnreadCountChange - Callback when unread count changes
 * @returns {Object} { el, load, refresh }
 */
export function createActivityFeed({ h, api, onNavigate, onUnreadCountChange }) {
  const el = h('div', { class: 'sidebar-view', 'data-view': 'activity' });

  // Header
  const header = h('div', { class: 'activity-feed-header' });
  const title = h('h2', {
    class: 'activity-feed-title',
    text: t('list.activity.title', 'Activity'),
  });
  const markReadBtn = h('button', {
    class: 'activity-mark-read-btn',
    type: 'button',
    text: t('list.activity.markAllRead', 'Mark all as read'),
    onclick: markAllRead,
  });
  header.append(title, markReadBtn);

  // Feed container
  const feed = h('div', { class: 'activity-feed' });

  // Empty state
  const emptyState = h('div', { class: 'activity-feed-empty' });
  const emptyIcon = h('img', {
    class: 'activity-feed-empty-icon',
    src: iconUrl('inbox'),
    alt: '',
    'aria-hidden': 'true',
  });
  const emptyText = h('div', {
    class: 'activity-feed-empty-text',
    text: t('list.activity.empty', 'No activity yet'),
  });
  emptyState.append(emptyIcon, emptyText);

  // Load more button
  const loadMoreBtn = h('button', {
    class: 'activity-load-more',
    type: 'button',
    text: t('list.activity.loadMore', 'Load more'),
    onclick: loadMore,
  });

  el.append(header, feed);

  let events = [];
  let offset = 0;
  let total = 0;
  let loading = false;
  const limit = 20;

  /**
   * Load activity events.
   */
  async function load() {
    if (loading) return;
    loading = true;

    try {
      const result = await api(`/api/activity?limit=${limit}&offset=0&excludeSelf=true`);
      events = result.events || [];
      offset = events.length;
      total = result.total || 0;

      renderEvents();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[activity-feed] Failed to load events:', err);
      feed.textContent = '';
      feed.append(
        h('div', {
          class: 'activity-feed-empty',
          text: t('list.activity.error', 'Failed to load activity'),
        })
      );
    } finally {
      loading = false;
    }
  }

  /**
   * Load more events.
   */
  async function loadMore() {
    if (loading || offset >= total) return;
    loading = true;
    loadMoreBtn.disabled = true;

    try {
      const result = await api(`/api/activity?limit=${limit}&offset=${offset}&excludeSelf=true`);
      const newEvents = result.events || [];
      events = events.concat(newEvents);
      offset += newEvents.length;

      renderEvents();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[activity-feed] Failed to load more events:', err);
    } finally {
      loading = false;
      loadMoreBtn.disabled = false;
    }
  }

  /**
   * Render events to the feed.
   */
  function renderEvents() {
    feed.textContent = '';

    if (events.length === 0) {
      feed.append(emptyState);
      return;
    }

    for (const event of events) {
      feed.append(createActivityItem(event, h, onNavigate));
    }

    // Show load more if there are more events
    if (offset < total) {
      feed.append(loadMoreBtn);
    }
  }

  /**
   * Mark all events as read.
   */
  async function markAllRead() {
    try {
      await api('/api/activity/mark-read', {
        method: 'POST',
        body: JSON.stringify({ eventId: null }), // null marks all as read
      });

      if (onUnreadCountChange) {
        onUnreadCountChange(0);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[activity-feed] Failed to mark as read:', err);
    }
  }

  /**
   * Get unread count.
   */
  async function fetchUnreadCount() {
    try {
      const result = await api('/api/activity/unread-count');
      if (onUnreadCountChange) {
        onUnreadCountChange(result.count || 0);
      }
      return result.count || 0;
    } catch {
      return 0;
    }
  }

  return {
    el,
    load,
    fetchUnreadCount,

    /**
     * Refresh the feed.
     */
    refresh() {
      offset = 0;
      events = [];
      load();
    },
  };
}