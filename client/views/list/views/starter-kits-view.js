import { t } from '../../../lib/ui-i18n.js';
import { createTagFilter, filterPresentationsByTags } from '../tag-filter.js';

/**
 * Create the starter kits view
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client function
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.starterKits - Starter kit presentations
 * @returns {object} - { el, tagFilter }
 */
export function createStarterKitsView({ h, api, renderCard, starterKits }) {
  let allPresentations = [...starterKits];
  let selectedTags = [];

  const starterKitsView = h('div', { class: 'sidebar-view', 'data-view': 'starterKits' });
  const starterKitsTitle = h('h2', { class: 'presentation-grid-title', text: t('list.starterKits.title', 'Starter kits') });
  const starterKitsHint = h('p', { class: 'help', text: t('list.starterKits.hint', 'Starter kits are templates you can duplicate to create new presentations. Click "Duplicate" to get your own copy.') });
  const starterKitsList = h('div', { class: 'list presentation-grid' });
  const emptyMsg = h('div', { class: 'help', text: t('list.starterKits.empty', 'No starter kits yet.') });

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
    starterKitsTitle,
    tagFilter.el,
  ]);

  // Render the list
  function renderList() {
    starterKitsList.innerHTML = '';
    const filtered = filterPresentationsByTags(allPresentations, selectedTags);

    if (filtered.length === 0) {
      if (selectedTags.length > 0) {
        starterKitsList.append(
          h('div', { class: 'help', text: t('list.noMatchingTags', 'No presentations match the selected tags.') })
        );
      } else {
        starterKitsList.append(emptyMsg.cloneNode(true));
      }
    } else {
      for (const p of filtered) {
        starterKitsList.append(renderCard(p, { isWorkspace: true, isStarterKit: true }));
      }
    }
  }

  // Initial render
  starterKitsView.append(header, starterKitsHint, starterKitsList);
  renderList();

  return {
    el: starterKitsView,
    tagFilter,
    refresh: () => {
      tagFilter.refresh();
      renderList();
    },
  };
}