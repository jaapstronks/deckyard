/**
 * Slide Library UI Controls
 * Renders scope, view, language, search, and filter controls
 */

import { t } from '../ui-i18n.js';
import { cleanStr } from '../../../shared/string-utils.js';

/**
 * Create UI control renderers for the slide library
 * @param {object} options
 * @param {Function} options.h - DOM helper function
 * @param {object} options.state - State management object
 * @param {object} options.apiOps - API operations object
 * @param {Function} options.SLIDE_TYPES - Slide types definition
 * @param {boolean} options.showLanguageSwitch - Whether to show language switch
 * @returns {object} Control render functions
 */
export function createSlideLibraryControls({
  h,
  state,
  apiOps,
  SLIDE_TYPES = null,
  showLanguageSwitch = false,
}) {
  const typeLabel = (type) => {
    const def = SLIDE_TYPES?.[type];
    return t(def?.labelKey || `slideType.${type}.label`, def?.label || type);
  };

  const renderScopeControls = (mount, rerender) => {
    const seg = h('div', { class: 'sb-segmented is-toggle ps-lib-scope' });
    const mkBtn = (scope, labelKey, fallback) =>
      h('button', {
        class: `sb-segmented-btn ${state.getScope() === scope ? 'is-active' : ''}`,
        type: 'button',
        text: t(labelKey, fallback),
        onclick: async () => {
          state.setScope(scope);
          await apiOps.fetchScope(scope);
          rerender?.();
        },
      });
    seg.append(
      mkBtn('personal', 'slideLibrary.scope.personal', 'Personal'),
      mkBtn('team', 'slideLibrary.scope.team', 'Team')
    );
    mount.append(seg);
  };

  const renderViewControls = (mount, rerender) => {
    const seg = h('div', { class: 'sb-segmented is-toggle ps-lib-scope' });
    const mkBtn = (view, labelKey, fallback) =>
      h('button', {
        class: `sb-segmented-btn ${state.getView() === view ? 'is-active' : ''}`,
        type: 'button',
        text: t(labelKey, fallback),
        onclick: async () => {
          state.setView(view);
          rerender?.();
        },
      });
    seg.append(
      mkBtn('library', 'slideLibrary.view.library', 'Library'),
      mkBtn('trash', 'slideLibrary.view.trash', 'Trash')
    );
    mount.append(seg);
  };

  const renderLangControls = (mount, { rerenderList } = {}) => {
    if (!showLanguageSwitch) return;
    const seg = h('div', { class: 'sb-segmented is-toggle ps-lib-lang' });
    const mkBtn = (lang, label) =>
      h('button', {
        class: `sb-segmented-btn ${state.getLang() === lang ? 'is-active' : ''}`,
        type: 'button',
        text: label,
        onclick: () => {
          state.setLang(lang);
          rerenderList?.();
          // Update button states
          seg.querySelectorAll('.sb-segmented-btn').forEach((btn) => {
            btn.classList.toggle('is-active', btn.textContent === label);
          });
        },
      });
    seg.append(
      mkBtn('nl', t('language.nl.short', 'NL')),
      mkBtn('en-GB', t('language.enGB.short', 'EN'))
    );
    mount.append(seg);
  };

  const renderSearch = (mount, { rerenderList } = {}) => {
    const input = h('input', {
      class: 'form-input ps-lib-search',
      type: 'search',
      placeholder: t('slideLibrary.search.placeholder', 'Search slide library…'),
      value: state.getQuery(),
      'aria-label': t('slideLibrary.search.aria', 'Search slide library'),
    });
    input.addEventListener('input', () => {
      state.setQuery(input.value);
      // Only re-render the list, not the entire UI (to keep focus)
      rerenderList?.();
    });
    mount.append(input);
  };

  const renderTypeFilters = (mount, scope, { rerenderList } = {}) => {
    const items = state.getCache(scope);
    const activeTypeFilter = state.getTypeFilter();
    const activeTagFilter = state.getTagFilter();

    // Only show non-trashed items for counting
    const activeItems = items.filter((it) => !(it?.isTrashed || it?.trashedAt));

    // Count items per type
    const typeCounts = new Map();
    for (const it of activeItems) {
      const type = cleanStr(it?.slideType);
      if (type) {
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      }
    }

    // Count items per tag
    const tagCounts = new Map();
    for (const item of activeItems) {
      const itemTags = Array.isArray(item?.tags) ? item.tags : [];
      for (const tag of itemTags) {
        const name = tag?.name || tag || '';
        if (name) {
          tagCounts.set(name, (tagCounts.get(name) || 0) + 1);
        }
      }
    }

    // Sort types by count (most common first), then alphabetically
    const sortedTypes = [...typeCounts.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([type]) => type);

    // Sort tags by count (most common first), then alphabetically
    const sortedTags = [...tagCounts.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([name]) => name);

    // Don't show filters if nothing to filter
    if (sortedTypes.length <= 1 && sortedTags.length === 0) return;

    const filters = h('div', { class: 'ps-lib-type-filters' });

    // "All" filter (only if we have type filters)
    if (sortedTypes.length > 1) {
      const allBtn = h('button', {
        class: `ps-lib-type-filter ${!activeTypeFilter ? 'is-active' : ''}`,
        type: 'button',
        onclick: () => {
          state.setTypeFilter('');
          rerenderList?.();
        },
      });
      allBtn.append(
        h('span', { text: t('slideLibrary.filter.all', 'All') }),
        h('span', { class: 'ps-lib-type-filter-count', text: String(activeItems.length) })
      );
      filters.append(allBtn);

      // Type-specific filters
      for (const type of sortedTypes) {
        const count = typeCounts.get(type) || 0;
        const label = typeLabel(type);
        const btn = h('button', {
          class: `ps-lib-type-filter ${activeTypeFilter === type ? 'is-active' : ''}`,
          type: 'button',
          'data-type': type,
          onclick: () => {
            state.setTypeFilter(type);
            rerenderList?.();
          },
        });
        btn.append(
          h('span', { text: label }),
          h('span', { class: 'ps-lib-type-filter-count', text: String(count) })
        );
        filters.append(btn);
      }
    }

    // Tag filters (toggleable, can select multiple)
    if (sortedTags.length > 0) {
      // Add separator if we have type filters
      if (sortedTypes.length > 1) {
        filters.append(h('span', { class: 'ps-lib-filter-sep' }));
      }

      for (const tagName of sortedTags) {
        const count = tagCounts.get(tagName) || 0;
        const isSelected = activeTagFilter.includes(tagName);
        const btn = h('button', {
          class: `ps-lib-type-filter ps-lib-tag-pill ${isSelected ? 'is-active' : ''}`,
          type: 'button',
          'data-tag': tagName,
          onclick: () => {
            if (isSelected) {
              state.removeTagFilter(tagName);
            } else {
              state.addTagFilter(tagName);
            }
            rerenderList?.();
          },
        });
        btn.append(
          h('span', { text: `#${tagName}` }),
          h('span', { class: 'ps-lib-type-filter-count', text: String(count) })
        );
        filters.append(btn);
      }
    }

    mount.append(filters);
  };

  return {
    typeLabel,
    renderScopeControls,
    renderViewControls,
    renderLangControls,
    renderSearch,
    renderTypeFilters,
  };
}