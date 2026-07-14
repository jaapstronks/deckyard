import { t } from '../../../lib/ui-i18n.js';
import { createTagFilter, filterPresentationsByTags } from '../tag-filter.js';

/**
 * Create the workspace presentations view
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.workspace - Workspace presentations
 * @returns {object} - { el, tagFilter }
 */
export function createWorkspaceView({ h, api, renderCard, workspace }) {
  let allPresentations = [...workspace];
  let selectedTags = [];

  const workspaceView = h('div', { class: 'sidebar-view', 'data-view': 'workspace' });
  const workspaceTitle = h('h2', { class: 'presentation-grid-title', text: t('list.workspace.title', 'Workspace') });
  const workspaceList = h('div', { class: 'list presentation-grid' });
  const emptyMsg = h('div', { class: 'help', text: t('list.workspace.empty', 'No workspace presentations yet.') });

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
    workspaceTitle,
    tagFilter.el,
  ]);

  // Render the list
  function renderList() {
    workspaceList.innerHTML = '';
    const filtered = filterPresentationsByTags(allPresentations, selectedTags);

    if (filtered.length === 0) {
      if (selectedTags.length > 0) {
        workspaceList.append(
          h('div', { class: 'help', text: t('list.noMatchingTags', 'No presentations match the selected tags.') })
        );
      } else {
        workspaceList.append(emptyMsg.cloneNode(true));
      }
    } else {
      for (const p of filtered) {
        workspaceList.append(renderCard(p, { isWorkspace: true }));
      }
    }
  }

  // Initial render
  workspaceView.append(header, workspaceList);
  renderList();

  return {
    el: workspaceView,
    tagFilter,
    refresh: () => {
      tagFilter.refresh();
      renderList();
    },
  };
}