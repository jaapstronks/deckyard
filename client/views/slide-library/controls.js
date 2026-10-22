/**
 * Slide Library UI Controls
 * Renders shelf, view, language, search, and filter controls
 */

import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';
import { getSupportedLangs } from '../../lib/format/i18n.js';
import { getLangShortLabel } from '../../lib/dom/lang-selector.js';

/** How long the search waits after the last keystroke before it asks. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Create UI control renderers for the slide library
 * @param {object} options
 * @param {object} options.state - State management object
 * @param {Function} options.SLIDE_TYPES - Slide types definition
 * @param {boolean} options.showLanguageSwitch - Whether to show language switch
 * @returns {object} Control render functions
 */
export function createSlideLibraryControls({
  state,
  SLIDE_TYPES = null,
  showLanguageSwitch = false,
}) {
  const typeLabel = (type) => {
    const def = SLIDE_TYPES?.[type];
    return t(def?.labelKey || `slideType.${type}.label`, def?.label || type);
  };

  /**
   * The language the list is narrowed to: the active one when the picker has
   * a language switch, else none. The one place that scope is decided, so the
   * list and the filter counts above it ask the server the same question
   * (B617, B822).
   *
   * @returns {string|undefined}
   */
  const languageParam = () =>
    showLanguageSwitch ? state.getLang() : undefined;

  const renderShelfControls = (mount, rerender) => {
    const seg = h('div', { class: 'sb-segmented is-toggle ps-lib-shelf' });
    const mkBtn = (shelf, labelKey, fallback) =>
      h('button', {
        class: `sb-segmented-btn ${state.getShelf() === shelf ? 'is-active' : ''}`,
        type: 'button',
        text: t(labelKey, fallback),
        onclick: () => {
          state.setShelf(shelf);
          rerender?.();
        },
      });
    seg.append(
      mkBtn('personal', 'slideLibrary.shelf.personal', 'Personal'),
      mkBtn('organization', 'slideLibrary.shelf.organization', 'Team'),
    );
    mount.append(seg);
  };

  const renderViewControls = (mount, rerender) => {
    const seg = h('div', { class: 'sb-segmented is-toggle ps-lib-shelf' });
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
      mkBtn('trash', 'slideLibrary.view.trash', 'Trash'),
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
    // The workspace's enabled deck languages, in axis order — two fixed NL/EN
    // buttons before D61.
    for (const code of getSupportedLangs())
      seg.append(mkBtn(code, getLangShortLabel(code)));
    mount.append(seg);
  };

  const renderSearch = (mount, { rerenderList } = {}) => {
    const input = h('input', {
      class: 'form-input ps-lib-search',
      type: 'search',
      placeholder: t(
        'slideLibrary.search.placeholder',
        'Search slide library…',
      ),
      value: state.getQuery(),
      'aria-label': t('slideLibrary.search.aria', 'Search slide library'),
    });
    // The server searches (B822); wait for a pause in typing, then read the
    // list again. Only the list, not the entire UI, so the input keeps focus.
    let timer = null;
    input.addEventListener('input', () => {
      state.setQuery(input.value);
      clearTimeout(timer);
      timer = setTimeout(() => rerenderList?.(), SEARCH_DEBOUNCE_MS);
    });
    mount.append(input);
  };

  const renderTypeFilters = (mount, shelf, { rerenderList } = {}) => {
    const facets = state.getFacets(shelf);
    const activeTypeFilter = state.getTypeFilter();
    const activeTagFilter = state.getTagFilter();

    // The counts are the server's (`GET …/facets`): live items in the active
    // language, over the whole shelf, not only the loaded pages.
    const typeCounts = new Map(
      (facets?.types || []).map((row) => [row.slideType, row.count]),
    );
    const tagCounts = new Map(
      (facets?.tags || []).map((row) => [row.name, row.count]),
    );
    const sortedTypes = [...typeCounts.keys()];
    const sortedTags = [...tagCounts.keys()];
    const total = [...typeCounts.values()].reduce((sum, n) => sum + n, 0);

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
        h('span', {
          class: 'ps-lib-type-filter-count',
          text: String(total),
        }),
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
          h('span', { class: 'ps-lib-type-filter-count', text: String(count) }),
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
          h('span', { class: 'ps-lib-type-filter-count', text: String(count) }),
        );
        filters.append(btn);
      }
    }

    mount.append(filters);
  };

  return {
    typeLabel,
    languageParam,
    renderShelfControls,
    renderViewControls,
    renderLangControls,
    renderSearch,
    renderTypeFilters,
  };
}
