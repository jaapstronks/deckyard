/**
 * Viewer list showing session details.
 * Supports privacy-aware rendering based on team analytics policy.
 */

import { t } from '../../lib/ui-i18n.js';
import { fmtRelativeTime } from '../../lib/user-format.js';
import { formatDuration, getSourceLabel } from '../../lib/analytics-format.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * Create viewer list component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Array} options.sessions - Session data
 * @param {number} options.total - Total session count
 * @param {Function} options.onLoadMore - Load more callback
 * @param {Function} options.onGenerateReport - Generate report callback
 * @param {Object} [options.privacySettings] - Privacy settings for team analytics
 * @param {string} [options.privacySettings.teamPolicy] - 'off' | 'aggregate' | 'opt-in-detailed'
 * @param {number} [options.privacySettings.internalViewCount] - Aggregated internal view count
 * @returns {Object} List API with el and update method
 */
export function createViewerList({ h, sessions, total, onLoadMore, onGenerateReport, privacySettings }) {
  const el = h('div', { class: 'analytics-section analytics-viewers' });

  // Sorting state
  let sortColumn = 'when';
  let sortDirection = 'desc';

  const header = h('div', { class: 'analytics-section-header' }, [
    h('h3', { text: t('analytics.recentViewers', 'Recent Viewers') }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('analytics.generateReport', 'Generate Report'),
      onclick: () => onGenerateReport?.(),
    }),
  ]);

  const container = h('div', { class: 'analytics-viewers-container', role: 'grid', 'aria-label': t('analytics.recentViewers', 'Recent Viewers') });
  const loadMoreBtn = h('button', {
    class: 'btn btn-secondary analytics-load-more',
    text: t('analytics.loadMore', 'Load More'),
    style: 'display: none;',
  });

  el.append(header, container, loadMoreBtn);

  let currentSessions = sessions || [];
  let loadedCount = currentSessions.length;

  /**
   * Sort sessions by the current sort column and direction.
   * @param {Array} sessionsList - Sessions to sort
   * @returns {Array} Sorted sessions
   */
  function sortSessions(sessionsList) {
    if (!sessionsList || sessionsList.length === 0) return [];

    return [...sessionsList].sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'duration':
          comparison = (a.durationSeconds || 0) - (b.durationSeconds || 0);
          break;
        case 'exitSlide':
          comparison = (a.exitSlideIndex ?? -1) - (b.exitSlideIndex ?? -1);
          break;
        case 'when':
        default:
          comparison = new Date(a.startedAt || 0) - new Date(b.startedAt || 0);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Handle clicking a sortable header.
   * @param {string} column - Column to sort by
   */
  function handleSort(column) {
    if (sortColumn === column) {
      // Toggle direction if same column
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New column, default to descending
      sortColumn = column;
      sortDirection = 'desc';
    }
    renderList();
  }

  renderList();

  function renderList() {
    container.innerHTML = '';

    const teamPolicy = privacySettings?.teamPolicy || 'aggregate';
    const internalViewCount = privacySettings?.internalViewCount || 0;

    // Filter sessions based on privacy policy
    let displaySessions = currentSessions;
    if (teamPolicy === 'off') {
      // Don't show internal viewers at all
      displaySessions = currentSessions.filter((s) => !s.isInternal);
    } else if (teamPolicy === 'aggregate') {
      // Show only external viewers in detail, aggregate internal
      displaySessions = currentSessions.filter((s) => !s.isInternal);
    }
    // 'opt-in-detailed': Show all, but respect attributionAllowed flag

    if (displaySessions.length === 0 && internalViewCount === 0) {
      container.append(
        h('div', { class: 'analytics-empty-state' }, [
          h('img', { class: 'analytics-empty-state-icon', src: iconUrl('eye'), alt: '', 'aria-hidden': 'true' }),
          h('p', { class: 'analytics-empty-state-title', text: t('analytics.noViewersYet', 'No viewers yet') }),
          h('p', { class: 'analytics-empty-state-description', text: t('analytics.shareToGetViewers', 'Once people view your presentation, their sessions will appear here.') }),
        ])
      );
      loadMoreBtn.style.display = 'none';
      return;
    }

    // Show aggregated internal team views banner (for aggregate policy)
    if (teamPolicy === 'aggregate' && internalViewCount > 0) {
      const internalBanner = h('div', { class: 'analytics-internal-aggregate' }, [
        h('img', { class: 'analytics-internal-icon', src: '/client/vendor/lucide-icons/users.svg', alt: '', 'aria-hidden': 'true' }),
        h('span', {
          text: t('analytics.teamViewers', '{{count}} team member views', { count: internalViewCount })
        }),
        h('span', {
          class: 'analytics-internal-note',
          text: t('analytics.teamViewersNote', '(aggregated for privacy)')
        }),
      ]);
      container.append(internalBanner);
    }

    if (displaySessions.length === 0) {
      // Only internal views, no external
      loadMoreBtn.style.display = 'none';
      return;
    }

    // Table header with ARIA roles for accessibility and sorting
    const createSortableHeader = (column, label) => {
      const isSorted = sortColumn === column;
      const headerEl = h('div', {
        class: `analytics-viewer-cell analytics-sortable-header ${isSorted ? 'is-sorted' : ''}`,
        role: 'columnheader',
        'aria-sort': isSorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none',
        onclick: () => handleSort(column),
      }, [
        h('span', { text: label }),
        h('span', { class: 'analytics-sort-indicator', text: isSorted ? (sortDirection === 'asc' ? '↑' : '↓') : '' }),
      ]);
      return headerEl;
    };

    const tableHeader = h('div', { class: 'analytics-viewer-row analytics-viewer-header', role: 'row' }, [
      h('div', { class: 'analytics-viewer-cell', role: 'columnheader', text: t('analytics.viewer', 'Viewer') }),
      h('div', { class: 'analytics-viewer-cell', role: 'columnheader', text: t('analytics.source', 'Source') }),
      createSortableHeader('duration', t('analytics.duration', 'Duration')),
      createSortableHeader('exitSlide', t('analytics.exitSlide', 'Exit Slide')),
      createSortableHeader('when', t('analytics.when', 'When')),
    ]);
    container.append(tableHeader);

    // Sort the sessions
    const sortedSessions = sortSessions(displaySessions);

    // Session rows
    sortedSessions.forEach((session) => {
      const row = createSessionRow(h, session, teamPolicy);
      container.append(row);
    });

    // Show/hide load more button
    if (loadedCount < total) {
      loadMoreBtn.style.display = 'block';
      loadMoreBtn.onclick = async () => {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = t('common.loading', 'Loading...');
        try {
          const more = await onLoadMore?.(loadedCount);
          if (more && more.length > 0) {
            currentSessions = [...currentSessions, ...more];
            loadedCount += more.length;
            renderList();
          }
        } catch (err) {
          console.error('[analytics] Failed to load more sessions:', err);
          loadMoreBtn.textContent = t('analytics.loadFailed', 'Failed to load');
          // Reset button text after a delay
          setTimeout(() => {
            loadMoreBtn.textContent = t('analytics.loadMore', 'Load More');
          }, 2000);
        } finally {
          loadMoreBtn.disabled = false;
        }
      };
    } else {
      loadMoreBtn.style.display = 'none';
    }
  }

  function update(newSessions, newTotal) {
    currentSessions = newSessions || [];
    loadedCount = currentSessions.length;
    total = newTotal;
    renderList();
  }

  return { el, update };
}

/**
 * Create a session row.
 * @param {Function} h - DOM helper
 * @param {Object} session - Session data
 * @param {string} teamPolicy - Privacy policy for team analytics
 * @returns {HTMLElement}
 */
function createSessionRow(h, session, teamPolicy = 'aggregate') {
  // Determine viewer identifier based on privacy settings
  let viewerText;
  let viewerBadge = '';
  let viewerBadgeIsIcon = false;

  if (session.isInternal) {
    // Internal viewer - respect attribution settings
    if (teamPolicy === 'opt-in-detailed' && session.attributionAllowed && session.viewerEmail) {
      // Show attributed name for viewers who opted in
      viewerText = session.viewerEmail;
      viewerBadge = '✓';
    } else {
      // Show as anonymous team member
      viewerText = t('analytics.teamMember', 'Team member');
      viewerBadge = 'users';
      viewerBadgeIsIcon = true;
    }
  } else {
    // External viewer - show full details
    viewerText = session.viewerEmail
      ? session.viewerEmail
      : session.deviceId
        ? t('analytics.deviceLabel', 'Device {{id}}...', { id: session.deviceId.substring(0, 8) })
        : t('analytics.anonymous', 'Anonymous');

    const viewerType = session.viewerType || 'anonymous';
    if (viewerType === 'guest') {
      viewerBadge = 'user';
      viewerBadgeIsIcon = true;
    } else if (viewerType === 'authenticated') {
      viewerBadge = '✓';
    }
  }

  // Exit slide display
  const exitSlide = session.exitSlideIndex != null
    ? t('analytics.slideNumber', 'Slide {{num}}', { num: session.exitSlideIndex + 1 })
    : '-';

  // Time display
  const when = session.startedAt
    ? fmtRelativeTime(session.startedAt)
    : '-';

  const row = h('div', { class: 'analytics-viewer-row', role: 'row' }, [
    h('div', { class: 'analytics-viewer-cell analytics-viewer-name', role: 'gridcell', 'data-label': '' }, [
      viewerBadge
        ? (viewerBadgeIsIcon
          ? h('img', { class: 'analytics-viewer-badge', src: `/client/vendor/lucide-icons/${viewerBadge}.svg`, alt: '', 'aria-hidden': 'true' })
          : h('span', { class: 'analytics-viewer-badge', 'aria-hidden': 'true', text: viewerBadge }))
        : null,
      h('span', { text: viewerText }),
    ].filter(Boolean)),
    h('div', { class: 'analytics-viewer-cell', role: 'gridcell', 'data-label': t('analytics.source', 'Source') }, [
      h('span', { class: `analytics-source-badge analytics-source-${session.sourceType}`, text: getSourceLabel(session.sourceType) }),
    ]),
    h('div', { class: 'analytics-viewer-cell', role: 'gridcell', 'data-label': t('analytics.duration', 'Duration'), text: formatDuration(session.durationSeconds) }),
    h('div', { class: 'analytics-viewer-cell', role: 'gridcell', 'data-label': t('analytics.exitSlide', 'Exit Slide'), text: exitSlide }),
    h('div', { class: 'analytics-viewer-cell analytics-viewer-when', role: 'gridcell', 'data-label': t('analytics.when', 'When'), text: when }),
  ]);

  return row;
}