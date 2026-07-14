import { t } from '../../../lib/ui-i18n.js';
import { createTagFilter, filterPresentationsByTags } from '../tag-filter.js';
import { createVisibilityFilter } from '../visibility-filter.js';
import { createNoPresentationsEmptyState } from '../empty-state.js';

/**
 * Create the "My Presentations" view showing all user-authored presentations
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.myPresentations - All presentations authored by the user
 * @returns {object} - { el, list, tagFilter, visibilityFilter }
 */
export function createMyPresentationsView({
  h,
  api,
  renderCard,
  myPresentations,
  onCreate,
  onBrowseTemplates,
}) {
  let allPresentations = [...myPresentations];
  let selectedTags = [];
  let selectedVisibility = null; // null = all

  const myPresentationsView = h('div', { class: 'sidebar-view', 'data-view': 'myPresentations' });
  const myPresentationsTitle = h('h2', { class: 'presentation-grid-title', text: t('list.myPresentations.title', 'My presentations') });
  const myPresentationsList = h('div', { class: 'list presentation-grid' });
  const emptyMsg = h('div', { class: 'help', text: t('list.myPresentations.empty', 'You haven\'t created any presentations yet.') });

  // Create tag filter
  const tagFilter = createTagFilter({
    api,
    onFilterChange: (tags) => {
      selectedTags = tags;
      renderList();
    },
  });

  // Create visibility filter
  const visibilityFilter = createVisibilityFilter({
    h,
    onFilterChange: (visibility) => {
      selectedVisibility = visibility;
      renderList();
    },
  });

  // Header with title and filters
  const header = h('div', { class: 'view-header-with-filter' }, [
    myPresentationsTitle,
    h('div', { class: 'view-filters' }, [
      visibilityFilter.el,
      tagFilter.el,
    ]),
  ]);

  // Filter presentations by visibility
  function filterByVisibility(presentations) {
    if (!selectedVisibility) return presentations;

    return presentations.filter((p) => {
      switch (selectedVisibility) {
        case 'private':
          return p.scope !== 'workspace' && !p.isPublished && (!p.collaboratorCount || p.collaboratorCount === 0);
        case 'published':
          return p.isPublished;
        case 'workspace':
          return p.scope === 'workspace';
        case 'shared':
          return p.collaboratorCount > 0 && p.scope !== 'workspace';
        default:
          return true;
      }
    });
  }

  // Render the list
  function renderList() {
    myPresentationsList.innerHTML = '';
    let filtered = filterPresentationsByTags(allPresentations, selectedTags);
    filtered = filterByVisibility(filtered);

    if (filtered.length === 0) {
      if (selectedTags.length > 0 || selectedVisibility) {
        myPresentationsList.append(
          h('div', { class: 'help', text: t('list.noMatchingFilters', 'No presentations match the selected filters.') })
        );
      } else if (typeof onCreate === 'function') {
        myPresentationsList.append(
          createNoPresentationsEmptyState({ h, onCreate, onBrowseTemplates })
        );
      } else {
        myPresentationsList.append(emptyMsg.cloneNode(true));
      }
    } else {
      for (const p of filtered) {
        myPresentationsList.append(renderCard(p, { isWorkspace: p.scope === 'workspace' }));
      }
    }
  }

  // Initial render
  myPresentationsView.append(header, myPresentationsList);
  renderList();

  return {
    el: myPresentationsView,
    list: myPresentationsList,
    tagFilter,
    visibilityFilter,
    refresh: () => {
      tagFilter.refresh();
      renderList();
    },
  };
}
