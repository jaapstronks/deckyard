import { t } from '../../../lib/ui-i18n.js';
import { createEmptyState } from '../../../lib/dom/empty-state.js';
import { h } from '../../../lib/dom.js';

/**
 * Normalize string for search (lowercase, remove accents)
 */
function normalizeForSearch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Check if a listed deck matches the search query. The owner is matched by
 * `ownerEmail`: the list projection carries no owner display name (that
 * arrives with identity decoupling).
 *
 * @param {object} presentation - a deck as the list endpoint projects it
 * @param {string} query - the raw query as typed
 * @returns {boolean}
 */
export function matchesQuery(presentation, query) {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return false;
  return [
    presentation.title,
    presentation.description,
    presentation.ownerEmail,
    presentation.theme,
    // Who shared it with you (shared decks only)
    presentation.sharedBy,
  ].some((field) => normalizeForSearch(field).includes(normalizedQuery));
}

/**
 * Create the search results view
 *
 * @param {object} opts
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.allPresentations - All presentations to search through
 * @param {Function} opts.onClearSearch - Callback when search is cleared
 * @returns {object} - { el, search, clear, getQuery }
 */
export function createSearchView({
  renderCard,
  allPresentations,
  onClearSearch,
}) {
  const searchView = h('div', { class: 'sidebar-view', 'data-view': 'search' });

  // Header with search info
  const headerRow = h('div', { class: 'search-header-row' });
  const searchTitle = h('h2', { class: 'presentation-grid-title' });
  const clearBtn = h('button', {
    class: 'btn btn-secondary btn-sm search-clear-btn',
    text: t('list.search.clear', 'Clear search'),
    onclick: () => {
      onClearSearch?.();
    },
  });
  headerRow.append(searchTitle, clearBtn);

  const searchList = h('div', { class: 'list presentation-grid' });
  const statusSlot = h('div', { class: 'search-status' });

  searchView.append(headerRow, searchList, statusSlot);

  let currentQuery = '';

  /**
   * Perform search and update the view
   */
  function search(query) {
    currentQuery = query?.trim() || '';

    // Clear previous results
    searchList.innerHTML = '';
    statusSlot.innerHTML = '';

    if (!currentQuery) {
      searchTitle.textContent = t('list.search.title', 'Search');
      statusSlot.append(
        h('div', {
          class: 'empty-note',
          text: t(
            'list.search.enterQuery',
            'Enter a search term to find presentations.',
          ),
        }),
      );
      return;
    }

    // Filter presentations
    const results = allPresentations.filter((p) =>
      matchesQuery(p, currentQuery),
    );

    // Update title with count
    searchTitle.textContent = t('list.search.resultsTitle', 'Search results', {
      query: currentQuery,
    });

    if (results.length === 0) {
      statusSlot.append(
        createEmptyState({
          icon: 'search',
          title: t(
            'list.search.noResults',
            'No presentations found for "{query}"',
            { query: currentQuery },
          ),
          message: t(
            'list.search.noResultsHint',
            'Try a different search term or check your spelling.',
          ),
        }),
      );
    } else {
      // Show count
      const countText =
        results.length === 1
          ? t('list.search.resultCount.one', '1 presentation found')
          : t('list.search.resultCount.many', '{count} presentations found', {
              count: results.length,
            });

      statusSlot.append(
        h('div', { class: 'search-result-count', text: countText }),
      );

      // Render results
      for (const p of results) {
        searchList.append(
          renderCard(p, {
            isOrganization: p.visibility === 'organization',
            isSharedWithMe: p.isSharedWithMe,
            sharedBy: p.sharedBy,
            permission: p.permission,
            highlightQuery: currentQuery,
          }),
        );
      }
    }
  }

  /**
   * Clear search and return to previous view
   */
  function clear() {
    currentQuery = '';
    searchList.innerHTML = '';
    statusSlot.innerHTML = '';
  }

  return {
    el: searchView,
    search,
    clear,
    getQuery: () => currentQuery,
  };
}
