/**
 * Unsplash Search Component
 *
 * Provides search interface for Unsplash photos with attribution.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * Create the Unsplash search component.
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {Function} options.api - API request function
 * @param {Function} options.onSelect - Callback when photo is selected (receives libraryItem)
 * @param {Function} options.setStatus - Status message setter
 * @param {Function} options.setBusy - Busy state setter
 * @returns {Object} Component with element property
 */
export function createUnsplashSearch({ h, api, onSelect, setStatus, setBusy }) {
  const container = h('div', { class: 'stock-media-search unsplash-search' });

  let results = [];
  let currentQuery = '';
  let currentPage = 1;
  let totalPages = 0;
  let isSearching = false;

  // Search input
  const searchInput = h('input', {
    type: 'search',
    class: 'input stock-media-search-input',
    placeholder: t('stockMedia.search.placeholder', 'Search {provider}...', { provider: 'Unsplash' }),
  });

  const searchBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('common.search', 'Search'),
  });

  const searchRow = h('div', { class: 'row gap-2 stock-media-search-row' }, [
    searchInput,
    searchBtn,
  ]);

  // Results grid
  const grid = h('div', { class: 'stock-media-grid' });

  // Load more button
  const loadMoreBtn = h('button', {
    class: 'btn btn-secondary stock-media-load-more',
    text: t('stockMedia.search.loadMore', 'Load more'),
    hidden: true,
  });

  // Attribution footer. One translatable sentence with the source name as a
  // link: interpolate a marker, then split on it so translators can move the
  // link within the sentence.
  const ATTR_MARK = '\u0000';
  const [attrBefore, attrAfter = ''] = t('stockMedia.attribution', 'Photos from {source}', {
    source: ATTR_MARK,
  }).split(ATTR_MARK);
  const attribution = h('div', { class: 'stock-media-attribution' }, [
    h('span', { text: attrBefore }),
    h('a', { href: 'https://unsplash.com', target: '_blank', rel: 'noopener', text: 'Unsplash' }),
    h('span', { text: attrAfter }),
  ]);

  container.append(searchRow, grid, loadMoreBtn, attribution);

  // Search function
  const search = async (query, page = 1) => {
    if (!query.trim() || isSearching) return;

    isSearching = true;
    setBusy(true);
    setStatus(t('stockMedia.search.searching', 'Searching...'));

    try {
      const params = new URLSearchParams({ q: query, page: String(page), per_page: '20' });
      const data = await api(`/api/stock-media/unsplash/search?${params}`);

      if (page === 1) {
        results = data.results || [];
        grid.innerHTML = '';
      } else {
        results = [...results, ...(data.results || [])];
      }

      currentQuery = query;
      currentPage = page;
      totalPages = data.totalPages || 0;

      renderResults();

      loadMoreBtn.hidden = currentPage >= totalPages;
      setStatus(results.length === 0
        ? t('stockMedia.search.noResults', 'No results found')
        : '');
    } catch (e) {
      console.error('Unsplash search error:', e);
      setStatus(t('stockMedia.search.error', 'Search failed'));
    } finally {
      isSearching = false;
      setBusy(false);
    }
  };

  // Render results
  const renderResults = () => {
    grid.innerHTML = '';

    for (const photo of results) {
      const item = h('div', { class: 'stock-media-item', 'data-id': photo.id });

      const img = h('img', {
        src: photo.urls.small,
        alt: photo.description || '',
        loading: 'lazy',
      });

      const overlay = h('div', { class: 'stock-media-item-overlay' }, [
        h('div', { class: 'stock-media-item-credit' }, [
          h('a', {
            href: photo.photographer.profileUrl + '?utm_source=presentation_system&utm_medium=referral',
            target: '_blank',
            rel: 'noopener',
            text: photo.photographer.name,
          }),
        ]),
      ]);

      item.append(img, overlay);
      item.addEventListener('click', () => handleSelect(photo));
      grid.append(item);
    }
  };

  // Handle photo selection
  const handleSelect = async (photo) => {
    if (isSearching) return;

    setBusy(true);
    setStatus(t('stockMedia.download.downloading', 'Downloading...'));

    try {
      const data = await api('/api/stock-media/unsplash/download', {
        method: 'POST',
        body: JSON.stringify({ photoId: photo.id, size: 'regular' }),
      });

      if (data.ok && data.libraryItem) {
        setStatus(t('stockMedia.download.success', 'Added to library'));
        onSelect(data.libraryItem);
      } else {
        throw new Error(data.error || t('stockMedia.download.error', 'Download failed'));
      }
    } catch (e) {
      console.error('Unsplash download error:', e);
      setStatus(t('stockMedia.download.error', 'Download failed'));
    } finally {
      setBusy(false);
    }
  };

  // Event handlers
  searchBtn.addEventListener('click', () => search(searchInput.value, 1));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search(searchInput.value, 1);
    }
  });
  loadMoreBtn.addEventListener('click', () => search(currentQuery, currentPage + 1));

  return {
    element: container,
    focus: () => searchInput.focus(),
  };
}
