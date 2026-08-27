/**
 * Slide Library State Management
 * Handles state for the slide library picker (cache, loading, selection, filters)
 */

import { DEFAULT_DECK_LANG } from '../../../shared/i18n-utils.js';
import { normalizeLang } from '../format/i18n.js';

/**
 * Create state management for the slide library picker
 * @param {object} options
 * @param {string} options.initialShelf - Initial shelf ('personal' | 'organization')
 * @param {string} options.initialQuery - Initial search query
 * @param {string} options.initialLang - Initial language
 * @returns {object} State management API
 */
export function createSlideLibraryState({
  initialShelf = 'organization',
  initialQuery = '',
  initialLang = DEFAULT_DECK_LANG,
} = {}) {
  let activeShelf =
    initialShelf === 'organization' ? 'organization' : 'personal';
  let activeView = 'library'; // library | trash
  let activeTypeFilter = ''; // empty = all types
  let activeTagFilter = []; // selected tag names for filtering
  let activeLang = normalizeLang(initialLang) || DEFAULT_DECK_LANG;
  let q = String(initialQuery || '');

  /** @type {{ personal: any[], organization: any[] }} */
  const cache = { personal: [], organization: [] };
  const loading = new Set();

  // Multi-select state
  const selectedItems = new Set();

  return {
    // Getters
    getShelf: () => activeShelf,
    getView: () => activeView,
    getTypeFilter: () => activeTypeFilter,
    getTagFilter: () => [...activeTagFilter],
    getLang: () => activeLang,
    getQuery: () => q,
    getCache: (shelf) =>
      cache[shelf === 'organization' ? 'organization' : 'personal'] || [],
    isLoading: (shelf) =>
      loading.has(shelf === 'organization' ? 'organization' : 'personal'),
    getSelectedIds: () => new Set(selectedItems),
    getSelectedCount: () => selectedItems.size,

    // Setters
    setShelf: (shelf) => {
      activeShelf = shelf === 'organization' ? 'organization' : 'personal';
    },
    setView: (view) => {
      activeView = view === 'trash' ? 'trash' : 'library';
    },
    setTypeFilter: (type) => {
      activeTypeFilter = type || '';
    },
    setTagFilter: (tags) => {
      activeTagFilter = Array.isArray(tags) ? [...tags] : [];
    },
    addTagFilter: (tag) => {
      if (!activeTagFilter.includes(tag)) {
        activeTagFilter = [...activeTagFilter, tag];
      }
    },
    removeTagFilter: (tag) => {
      activeTagFilter = activeTagFilter.filter((t) => t !== tag);
    },
    setLang: (lang) => {
      const normalized = normalizeLang(lang);
      if (normalized) activeLang = normalized;
    },
    setQuery: (query) => {
      q = String(query || '');
    },
    setCache: (shelf, items) => {
      const s = shelf === 'organization' ? 'organization' : 'personal';
      cache[s] = Array.isArray(items) ? items : [];
    },
    setLoading: (shelf, isLoading) => {
      const s = shelf === 'organization' ? 'organization' : 'personal';
      if (isLoading) {
        loading.add(s);
      } else {
        loading.delete(s);
      }
    },

    // Selection
    toggleSelection: (item) => {
      if (selectedItems.has(item.id)) {
        selectedItems.delete(item.id);
      } else {
        selectedItems.add(item.id);
      }
    },
    isSelected: (id) => selectedItems.has(id),
    deselect: (id) => {
      selectedItems.delete(id);
    },
    clearSelection: () => {
      selectedItems.clear();
    },
    getSelectedItems: () => {
      const shelf =
        activeShelf === 'organization' ? 'organization' : 'personal';
      const items = cache[shelf] || [];
      return items.filter((it) => selectedItems.has(it.id));
    },
    // Selected items in the order they were checked (the Set preserves
    // insertion order). Used by the compose flow so the composed deck follows
    // the user's selection order rather than the library's sort order.
    getSelectedItemsInOrder: () => {
      const shelf =
        activeShelf === 'organization' ? 'organization' : 'personal';
      const byId = new Map((cache[shelf] || []).map((it) => [it.id, it]));
      return [...selectedItems].map((id) => byId.get(id)).filter(Boolean);
    },

    // Cache operations
    patchInCache: (shelf, id, updater) => {
      const s = shelf === 'organization' ? 'organization' : 'personal';
      const arr = cache[s];
      const idx = arr.findIndex((x) => String(x?.id || '') === id);
      if (idx < 0) return { ok: false };
      const prev = arr[idx];
      const next = updater(prev);
      arr[idx] = next;
      return { ok: true, prev, next };
    },

    // Bulk state update
    setState: ({ shelf, query, lang } = {}) => {
      if (shelf === 'organization' || shelf === 'personal') activeShelf = shelf;
      if (typeof query === 'string') q = query;
      const normalizedLang = normalizeLang(lang);
      if (normalizedLang) activeLang = normalizedLang;
    },

    // Reset filters (for shelf/view changes)
    resetFilters: () => {
      activeTypeFilter = '';
      activeTagFilter = [];
      selectedItems.clear();
    },
  };
}
