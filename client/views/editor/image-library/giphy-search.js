/**
 * Giphy Search Component
 *
 * Provides search interface for Giphy GIFs with "Powered by GIPHY" branding.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * Create the Giphy search component.
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {Function} options.api - API request function
 * @param {Function} options.onSelect - Callback when GIF is selected (receives libraryItem)
 * @param {Function} options.setStatus - Status message setter
 * @param {Function} options.setBusy - Busy state setter
 * @returns {Object} Component with element property
 */
export function createGiphySearch({ h, api, onSelect, setStatus, setBusy }) {
  const container = h('div', { class: 'stock-media-search giphy-search' });

  let results = [];
  let currentQuery = '';
  let currentOffset = 0;
  let totalCount = 0;
  let isSearching = false;
  let showingTrending = true;

  // Search input
  const searchInput = h('input', {
    type: 'search',
    class: 'input stock-media-search-input',
    placeholder: t('stockMedia.search.placeholder', 'Search {provider}...', { provider: 'Giphy' }),
  });

  const searchBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('common.search', 'Search'),
  });

  const trendingBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('stockMedia.giphy.trending', 'Trending'),
  });

  const searchRow = h('div', { class: 'row gap-2 stock-media-search-row' }, [
    searchInput,
    searchBtn,
    trendingBtn,
  ]);

  // Results grid
  const grid = h('div', { class: 'stock-media-grid stock-media-grid-giphy' });

  // Load more button
  const loadMoreBtn = h('button', {
    class: 'btn btn-secondary stock-media-load-more',
    text: t('stockMedia.search.loadMore', 'Load more'),
    hidden: true,
  });

  // Powered by GIPHY badge (required by API terms)
  const giphyBadge = h('div', { class: 'stock-media-attribution giphy-attribution' }, [
    h('img', {
      src: 'https://giphy.com/static/img/giphy-logo-static.png',
      alt: 'Powered by GIPHY',
      class: 'giphy-logo',
    }),
    h('span', { text: t('stockMedia.giphy.poweredBy', 'Powered by GIPHY') }),
  ]);

  container.append(searchRow, grid, loadMoreBtn, giphyBadge);

  // Search function
  const search = async (query, offset = 0) => {
    if (isSearching) return;

    isSearching = true;
    setBusy(true);
    setStatus(t('stockMedia.search.searching', 'Searching...'));
    showingTrending = false;

    try {
      const params = new URLSearchParams({ q: query, offset: String(offset), limit: '20' });
      const data = await api(`/api/stock-media/giphy/search?${params}`);

      if (offset === 0) {
        results = data.results || [];
        grid.innerHTML = '';
      } else {
        results = [...results, ...(data.results || [])];
      }

      currentQuery = query;
      currentOffset = offset;
      totalCount = data.total || 0;

      renderResults();

      loadMoreBtn.hidden = results.length >= totalCount;
      setStatus(results.length === 0
        ? t('stockMedia.search.noResults', 'No results found')
        : '');
    } catch (e) {
      console.error('Giphy search error:', e);
      setStatus(t('stockMedia.search.error', 'Search failed'));
    } finally {
      isSearching = false;
      setBusy(false);
    }
  };

  // Trending function
  const loadTrending = async (offset = 0) => {
    if (isSearching) return;

    isSearching = true;
    setBusy(true);
    setStatus(t('stockMedia.search.searching', 'Searching...'));
    showingTrending = true;

    try {
      const params = new URLSearchParams({ offset: String(offset), limit: '20' });
      const data = await api(`/api/stock-media/giphy/trending?${params}`);

      if (offset === 0) {
        results = data.results || [];
        grid.innerHTML = '';
      } else {
        results = [...results, ...(data.results || [])];
      }

      currentQuery = '';
      currentOffset = offset;
      totalCount = data.total || 0;

      renderResults();

      loadMoreBtn.hidden = results.length >= totalCount || results.length >= 100; // Limit trending
      setStatus('');
    } catch (e) {
      console.error('Giphy trending error:', e);
      setStatus(t('stockMedia.search.error', 'Search failed'));
    } finally {
      isSearching = false;
      setBusy(false);
    }
  };

  // Render results
  const renderResults = () => {
    grid.innerHTML = '';

    for (const gif of results) {
      const item = h('div', { class: 'stock-media-item giphy-item', 'data-id': gif.id });

      // Use still image as preview, animate on hover
      const img = h('img', {
        src: gif.urls.still || gif.urls.preview,
        'data-animated': gif.urls.preview,
        'data-still': gif.urls.still || gif.urls.preview,
        alt: gif.title || 'GIF',
        loading: 'lazy',
      });

      // Hover to animate
      item.addEventListener('mouseenter', () => {
        img.src = gif.urls.preview;
      });
      item.addEventListener('mouseleave', () => {
        if (gif.urls.still) {
          img.src = gif.urls.still;
        }
      });

      item.append(img);
      item.addEventListener('click', () => handleSelect(gif));
      grid.append(item);
    }
  };

  // Handle GIF selection
  const handleSelect = async (gif) => {
    if (isSearching) return;

    setBusy(true);
    setStatus(t('stockMedia.download.downloading', 'Downloading...'));

    try {
      const data = await api('/api/stock-media/giphy/download', {
        method: 'POST',
        body: JSON.stringify({ gifId: gif.id }),
      });

      if (data.ok && data.libraryItem) {
        setStatus(t('stockMedia.download.success', 'Added to library'));
        onSelect(data.libraryItem);
      } else {
        throw new Error(data.error || t('stockMedia.download.error', 'Download failed'));
      }
    } catch (e) {
      console.error('Giphy download error:', e);
      setStatus(t('stockMedia.download.error', 'Download failed'));
    } finally {
      setBusy(false);
    }
  };

  // Event handlers
  searchBtn.addEventListener('click', () => {
    if (searchInput.value.trim()) {
      search(searchInput.value, 0);
    }
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchInput.value.trim()) {
        search(searchInput.value, 0);
      }
    }
  });
  trendingBtn.addEventListener('click', () => {
    searchInput.value = '';
    loadTrending(0);
  });
  loadMoreBtn.addEventListener('click', () => {
    if (showingTrending) {
      loadTrending(currentOffset + 20);
    } else {
      search(currentQuery, currentOffset + 20);
    }
  });

  // Load trending by default when shown
  const init = () => {
    if (results.length === 0) {
      loadTrending(0);
    }
  };

  return {
    element: container,
    focus: () => searchInput.focus(),
    init,
  };
}
