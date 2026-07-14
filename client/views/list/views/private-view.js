import { t } from '../../../lib/ui-i18n.js';
import { createTagFilter, filterPresentationsByTags } from '../tag-filter.js';
import { createNoPresentationsEmptyState } from '../empty-state.js';

/**
 * Create the private presentations view
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.priv - Private presentations
 * @returns {object} - { el, list, tagFilter }
 */
export function createPrivateView({
  h,
  api,
  renderCard,
  priv,
  onCreate,
  onBrowseTemplates,
}) {
  let allPresentations = [...priv];
  let selectedTags = [];

  const privateView = h('div', { class: 'sidebar-view', 'data-view': 'private' });
  const privateTitle = h('h2', { class: 'presentation-grid-title', text: t('list.private.title', 'Private') });
  const privateList = h('div', { class: 'list presentation-grid' });
  const emptyMsg = h('div', { class: 'help', text: t('list.private.empty', 'No private presentations yet.') });

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
    privateTitle,
    tagFilter.el,
  ]);

  // Render the list
  function renderList() {
    privateList.innerHTML = '';
    const filtered = filterPresentationsByTags(allPresentations, selectedTags);

    if (filtered.length === 0) {
      if (selectedTags.length > 0) {
        privateList.append(
          h('div', { class: 'help', text: t('list.noMatchingTags', 'No presentations match the selected tags.') })
        );
      } else if (typeof onCreate === 'function') {
        privateList.append(
          createNoPresentationsEmptyState({ h, onCreate, onBrowseTemplates })
        );
      } else {
        privateList.append(emptyMsg.cloneNode(true));
      }
    } else {
      for (const p of filtered) {
        privateList.append(renderCard(p, { isWorkspace: false }));
      }
    }
  }

  // Initial render
  privateView.append(header, privateList);
  renderList();

  return {
    el: privateView,
    list: privateList,
    tagFilter,
    refresh: () => {
      tagFilter.refresh();
      renderList();
    },
  };
}