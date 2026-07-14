import { t } from '../../../lib/ui-i18n.js';
import { iconUrl } from '../../../../shared/icon-names.js';

/**
 * Create the search results view
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Array} opts.allPresentations - All presentations to search through
 * @param {Function} opts.onClearSearch - Callback when search is cleared
 * @returns {object} - { el, search, clear, getQuery }
 */
export function createSearchView({ h, renderCard, allPresentations, onClearSearch }) {
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
  const emptyState = h('div', { class: 'search-empty-state' });

  searchView.append(headerRow, searchList, emptyState);

  let currentQuery = '';

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
   * Check if a presentation matches the search query
   */
  function matchesQuery(presentation, query) {
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) return false;

    // Search in title
    if (normalizeForSearch(presentation.title)?.includes(normalizedQuery)) {
      return true;
    }

    // Search in description
    if (normalizeForSearch(presentation.description)?.includes(normalizedQuery)) {
      return true;
    }

    // Search in owner email/name
    if (normalizeForSearch(presentation.ownerEmail)?.includes(normalizedQuery)) {
      return true;
    }
    if (normalizeForSearch(presentation.ownerName)?.includes(normalizedQuery)) {
      return true;
    }

    // Search in theme
    if (normalizeForSearch(presentation.theme)?.includes(normalizedQuery)) {
      return true;
    }

    // Search in sharedBy (for shared presentations)
    if (normalizeForSearch(presentation.sharedBy)?.includes(normalizedQuery)) {
      return true;
    }

    return false;
  }

  /**
   * Perform search and update the view
   */
  function search(query) {
    currentQuery = query?.trim() || '';

    // Clear previous results
    searchList.innerHTML = '';
    emptyState.innerHTML = '';

    if (!currentQuery) {
      searchTitle.textContent = t('list.search.title', 'Search');
      emptyState.append(
        h('div', { class: 'help', text: t('list.search.enterQuery', 'Enter a search term to find presentations.') })
      );
      return;
    }

    // Filter presentations
    const results = allPresentations.filter(p => matchesQuery(p, currentQuery));

    // Update title with count
    searchTitle.textContent = t('list.search.resultsTitle', 'Search results', { query: currentQuery });

    if (results.length === 0) {
      emptyState.append(
        h('div', { class: 'search-no-results' }, [
          h('img', { class: 'search-no-results-icon', src: iconUrl('search'), alt: '', 'aria-hidden': 'true' }),
          h('div', { class: 'search-no-results-text', text: t('list.search.noResults', 'No presentations found for "{query}"', { query: currentQuery }) }),
          h('div', { class: 'search-no-results-hint', text: t('list.search.noResultsHint', 'Try a different search term or check your spelling.') }),
        ])
      );
    } else {
      // Show count
      const countText = results.length === 1
        ? t('list.search.resultCount.one', '1 presentation found')
        : t('list.search.resultCount.many', '{count} presentations found', { count: results.length });

      emptyState.append(
        h('div', { class: 'search-result-count', text: countText })
      );

      // Render results
      for (const p of results) {
        searchList.append(renderCard(p, {
          isWorkspace: p.scope === 'workspace',
          isSharedWithMe: p.isSharedWithMe,
          sharedBy: p.sharedBy,
          permission: p.permission,
          highlightQuery: currentQuery,
        }));
      }
    }
  }

  /**
   * Clear search and return to previous view
   */
  function clear() {
    currentQuery = '';
    searchList.innerHTML = '';
    emptyState.innerHTML = '';
  }

  return {
    el: searchView,
    search,
    clear,
    getQuery: () => currentQuery,
  };
}