/**
 * Slide Library State Management
 * Handles state for the slide library picker (cache, loading, selection, filters)
 */

import { normalizeLang } from '../../../shared/i18n-utils.js';

const SUPPORTED_LANGS = ['nl', 'en-GB'];

/**
 * Create state management for the slide library picker
 * @param {object} options
 * @param {string} options.initialScope - Initial scope ('personal' | 'team')
 * @param {string} options.initialQuery - Initial search query
 * @param {string} options.initialLang - Initial language
 * @returns {object} State management API
 */
export function createSlideLibraryState({
  initialScope = 'team',
  initialQuery = '',
  initialLang = 'nl',
} = {}) {
  let activeScope = initialScope === 'team' ? 'team' : 'personal';
  let activeView = 'library'; // library | trash
  let activeTypeFilter = ''; // empty = all types
  let activeTagFilter = []; // selected tag names for filtering
  let activeLang = normalizeLang(initialLang) || 'nl';
  let q = String(initialQuery || '');

  /** @type {{ personal: any[], team: any[] }} */
  const cache = { personal: [], team: [] };
  const loading = new Set();

  // Multi-select state
  const selectedItems = new Set();

  return {
    // Getters
    getScope: () => activeScope,
    getView: () => activeView,
    getTypeFilter: () => activeTypeFilter,
    getTagFilter: () => [...activeTagFilter],
    getLang: () => activeLang,
    getQuery: () => q,
    getCache: (scope) => cache[scope === 'team' ? 'team' : 'personal'] || [],
    isLoading: (scope) => loading.has(scope === 'team' ? 'team' : 'personal'),
    getSelectedIds: () => new Set(selectedItems),
    getSelectedCount: () => selectedItems.size,

    // Setters
    setScope: (scope) => {
      activeScope = scope === 'team' ? 'team' : 'personal';
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
    setCache: (scope, items) => {
      const s = scope === 'team' ? 'team' : 'personal';
      cache[s] = Array.isArray(items) ? items : [];
    },
    setLoading: (scope, isLoading) => {
      const s = scope === 'team' ? 'team' : 'personal';
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
      const scope = activeScope === 'team' ? 'team' : 'personal';
      const items = cache[scope] || [];
      return items.filter((it) => selectedItems.has(it.id));
    },
    // Selected items in the order they were checked (the Set preserves
    // insertion order). Used by the compose flow so the composed deck follows
    // the user's selection order rather than the library's sort order.
    getSelectedItemsInOrder: () => {
      const scope = activeScope === 'team' ? 'team' : 'personal';
      const byId = new Map((cache[scope] || []).map((it) => [it.id, it]));
      return [...selectedItems].map((id) => byId.get(id)).filter(Boolean);
    },

    // Cache operations
    patchInCache: (scope, id, updater) => {
      const s = scope === 'team' ? 'team' : 'personal';
      const arr = cache[s];
      const idx = arr.findIndex((x) => String(x?.id || '') === id);
      if (idx < 0) return { ok: false };
      const prev = arr[idx];
      const next = updater(prev);
      arr[idx] = next;
      return { ok: true, prev, next };
    },

    // Bulk state update
    setState: ({ scope, query, lang } = {}) => {
      if (scope === 'team' || scope === 'personal') activeScope = scope;
      if (typeof query === 'string') q = query;
      const normalizedLang = normalizeLang(lang);
      if (normalizedLang) activeLang = normalizedLang;
    },

    // Reset filters (for scope/view changes)
    resetFilters: () => {
      activeTypeFilter = '';
      activeTagFilter = [];
      selectedItems.clear();
    },

    SUPPORTED_LANGS,
  };
}