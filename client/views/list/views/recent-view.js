import { t } from '../../../lib/ui-i18n.js';
import { createTagFilter, filterPresentationsByTags } from '../tag-filter.js';

/**
 * Create the recent presentations view
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.allByDate - All presentations sorted by date
 * @returns {object} - { el, tagFilter }
 */
export function createRecentView({ h, api, renderCard, allByDate }) {
  let allPresentations = [...allByDate];
  let selectedTags = [];

  const recentView = h('div', { class: 'sidebar-view', 'data-view': 'recent' });
  const recentTitle = h('h2', { class: 'presentation-grid-title', text: t('list.recent.title', 'Recent') });
  const recentList = h('div', { class: 'list presentation-grid' });
  const emptyMsg = h('div', { class: 'help', text: t('list.recent.empty', 'No recent presentations.') });

  // Create tag filter
  const tagFilter = createTagFilter({
    api,
    onFilterChange: (tags) => {
      selectedTags = tags;
      renderList();
    },
  });

  // Header with title and filter
  const header = h('div', { class: 'view-header-with-filter' }, [
    recentTitle,
    tagFilter.el,
  ]);

  // Render the list
  function renderList() {
    recentList.innerHTML = '';
    const filtered = filterPresentationsByTags(allPresentations, selectedTags);

    if (filtered.length === 0) {
      if (selectedTags.length > 0) {
        recentList.append(
          h('div', { class: 'help', text: t('list.noMatchingTags', 'No presentations match the selected tags.') })
        );
      } else {
        recentList.append(emptyMsg.cloneNode(true));
      }
    } else {
      for (const p of filtered) {
        recentList.append(renderCard(p, {
          isWorkspace: p.scope === 'workspace',
          isSharedWithMe: p.isSharedWithMe,
          sharedBy: p.sharedBy,
          permission: p.permission,
        }));
      }
    }
  }

  // Initial render
  recentView.append(header, recentList);
  renderList();

  return {
    el: recentView,
    list: recentList,
    tagFilter,
    refresh: () => {
      tagFilter.refresh();
      renderList();
    },
  };
}