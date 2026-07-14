import { h, installDismissOnOutside } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Filter presentations by selected tags (case-insensitive). Handles both
 * string tags and `{ name }` tag objects. Empty selection passes through.
 * @param {Array} presentations
 * @param {string[]} selectedTags
 * @returns {Array}
 */
export function filterPresentationsByTags(presentations, selectedTags) {
  if (!selectedTags || selectedTags.length === 0) return presentations;
  return (presentations || []).filter((p) => {
    const pTags = (p.tags || []).map((tag) =>
      (typeof tag === 'string' ? tag : tag.name).toLowerCase()
    );
    return selectedTags.some((tag) => pTags.includes(tag.toLowerCase()));
  });
}

/**
 * Create a tag filter component for filtering presentations by tags.
 *
 * @param {object} opts
 * @param {Function} opts.api - API client function
 * @param {Function} opts.onFilterChange - Callback when filter changes (receives array of selected tag names)
 * @returns {object} - { el, getSelectedTags, clearFilter, refresh }
 */
export function createTagFilter({ api, onFilterChange }) {
  let allTags = [];
  let selectedTags = new Set();
  let isOpen = false;

  // Main container
  const el = h('div', { class: 'tag-filter' });

  // Filter button that shows selected count
  const filterBtn = h('button', {
    class: 'tag-filter-btn',
    type: 'button',
    onclick: () => toggleDropdown(),
  });

  // Dropdown container
  const dropdown = h('div', { class: 'tag-filter-dropdown' });

  // Search input inside dropdown
  const searchInput = h('input', {
    type: 'text',
    class: 'tag-filter-search',
    placeholder: t('tags.filter.search', 'Search tags…'),
  });

  // Tag list container
  const tagList = h('div', { class: 'tag-filter-list' });

  // Clear button
  const clearBtn = h('button', {
    class: 'tag-filter-clear',
    type: 'button',
    text: t('tags.filter.clear', 'Clear'),
    onclick: (e) => {
      e.stopPropagation();
      clearFilter();
    },
  });

  dropdown.append(searchInput, tagList, clearBtn);
  el.append(filterBtn, dropdown);

  // Update the filter button text
  function updateButtonText() {
    const count = selectedTags.size;
    if (count === 0) {
      filterBtn.textContent = t('tags.filter.button', 'Filter by tag');
      filterBtn.classList.remove('has-selection');
    } else {
      filterBtn.textContent = t('tags.filter.buttonActive', '{count} tag(s) selected', {
        count: String(count),
      });
      filterBtn.classList.add('has-selection');
    }
  }

  // Render the tag list
  function renderTags(filter = '') {
    tagList.innerHTML = '';
    const lowerFilter = filter.toLowerCase();
    const filtered = allTags.filter((tag) =>
      tag.name.toLowerCase().includes(lowerFilter)
    );

    if (filtered.length === 0) {
      tagList.append(
        h('div', {
          class: 'tag-filter-empty',
          text: t('tags.filter.empty', 'No tags found'),
        })
      );
      return;
    }

    for (const tag of filtered) {
      const isSelected = selectedTags.has(tag.name);
      const item = h('label', { class: `tag-filter-item${isSelected ? ' is-selected' : ''}` }, [
        h('input', {
          type: 'checkbox',
          checked: isSelected,
          onchange: () => {
            if (selectedTags.has(tag.name)) {
              selectedTags.delete(tag.name);
            } else {
              selectedTags.add(tag.name);
            }
            renderTags(searchInput.value);
            updateButtonText();
            onFilterChange?.(Array.from(selectedTags));
          },
        }),
        h('span', { class: 'tag-filter-item-name', text: tag.name }),
        h('span', { class: 'tag-filter-item-count', text: String(tag.count) }),
      ]);
      tagList.append(item);
    }
  }

  // Toggle dropdown visibility
  function toggleDropdown() {
    isOpen = !isOpen;
    dropdown.classList.toggle('is-open', isOpen);
    if (isOpen) {
      searchInput.value = '';
      searchInput.focus();
      renderTags();
    }
  }

  // Close dropdown
  function closeDropdown() {
    isOpen = false;
    dropdown.classList.remove('is-open');
  }

  // Search handler
  searchInput.addEventListener('input', () => {
    renderTags(searchInput.value);
  });

  // Install dismiss handler
  const detachDismiss = installDismissOnOutside({
    rootEl: el,
    isOpen: () => isOpen,
    close: closeDropdown,
    returnFocusEl: filterBtn,
  });

  // Load tags from API
  async function loadTags() {
    try {
      allTags = await api('/api/tags');
      renderTags();
    } catch (err) {
      console.error('Failed to load tags:', err);
      allTags = [];
    }
  }

  // Clear filter
  function clearFilter() {
    selectedTags.clear();
    updateButtonText();
    renderTags(searchInput.value);
    onFilterChange?.([]);
  }

  // Get selected tags
  function getSelectedTags() {
    return Array.from(selectedTags);
  }

  // Refresh tags from API
  async function refresh() {
    await loadTags();
  }

  // Initial render
  updateButtonText();

  return {
    el,
    getSelectedTags,
    clearFilter,
    refresh,
    load: loadTags,
    detach: detachDismiss,
  };
}