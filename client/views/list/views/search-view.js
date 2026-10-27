import { t } from '../../../lib/ui-i18n.js';
import { createEmptyState } from '../../../lib/dom/empty-state.js';
import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { toGridDeck } from '../data.js';

/** The shortest query the server searches for. */
const MIN_QUERY_LENGTH = 2;

/**
 * Create the search results view
 *
 * @param {object} opts
 * @param {Function} opts.api - API client
 * @param {Function} opts.renderCard - Card renderer function
 * @param {Function} opts.onClearSearch - Callback when search is cleared
 * @returns {object} - { el, search, clear, getQuery }
 */
export function createSearchView({ api, renderCard, onClearSearch }) {
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
  let generation = 0;

  /** Show one status line in place of results. */
  function showStatus(node) {
    searchList.replaceChildren();
    statusSlot.replaceChildren(node);
  }

  /**
   * Search every deck the person can open, on the server: the deck list is
   * paged (D358, B821), so the client no longer holds all of it to filter.
   * The server matches title, description and owner address (and, with
   * deep search, slide text); a response overtaken by a newer query is
   * dropped.
   */
  async function search(query) {
    currentQuery = query?.trim() || '';
    const mine = ++generation;

    if (!currentQuery) {
      searchTitle.textContent = t('list.search.title', 'Presentation search');
      showStatus(
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

    searchTitle.textContent = t('list.search.resultsTitle', 'Search results', {
      query: currentQuery,
    });

    if (currentQuery.length < MIN_QUERY_LENGTH) {
      showStatus(
        h('div', {
          class: 'empty-note',
          text: t(
            'list.search.tooShort',
            'Type at least two characters to search.',
          ),
        }),
      );
      return;
    }

    let results;
    try {
      const params = new URLSearchParams({ q: currentQuery, ownership: 'all' });
      const resp = await api(`/api/presentations/search?${params}`);
      results = (resp?.results || []).map(toGridDeck);
    } catch {
      if (mine !== generation) return;
      const loadError = createInlineError({ live: 'polite' });
      showStatus(loadError.el);
      loadError.show(t('list.search.loadError', 'Search failed.'), {
        focus: false,
      });
      return;
    }
    if (mine !== generation) return;

    if (results.length === 0) {
      showStatus(
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
      return;
    }

    const countText = t(
      'list.search.resultCount',
      { one: '1 presentation found', many: '{count} presentations found' },
      { count: results.length },
    );
    statusSlot.replaceChildren(
      h('div', { class: 'search-result-count', text: countText }),
    );
    searchList.replaceChildren(
      ...results.map((p) =>
        renderCard(p, {
          isOrganization: p.visibility === 'organization',
          isSharedWithMe: p.isSharedWithMe,
          sharedBy: p.sharedBy,
          permission: p.permission,
          highlightQuery: currentQuery,
        }),
      ),
    );
  }

  /**
   * Clear search and return to previous view
   */
  function clear() {
    currentQuery = '';
    generation++;
    searchList.replaceChildren();
    statusSlot.replaceChildren();
  }

  return {
    el: searchView,
    search,
    clear,
    getQuery: () => currentQuery,
  };
}
