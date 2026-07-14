import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Create a visibility filter component for filtering presentations by visibility status.
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper function (optional, uses default h)
 * @param {Function} opts.onFilterChange - Callback when filter changes (receives visibility key or null for all)
 * @returns {object} - { el, getValue, clearFilter, detach }
 */
export function createVisibilityFilter({ h: hFunc, onFilterChange }) {
  const createElement = hFunc || h;
  let selectedVisibility = null;

  // Main container - segmented button group
  const el = createElement('div', { class: 'visibility-filter' });

  // Filter options
  const options = [
    { key: null, label: () => t('list.filter.all', 'All') },
    { key: 'private', label: () => t('list.filter.privateOnly', 'Private') },
    { key: 'published', label: () => t('list.filter.published', 'Published') },
    { key: 'workspace', label: () => t('list.filter.sharedWorkspace', 'Workspace') },
    { key: 'shared', label: () => t('list.filter.sharedPeople', 'Shared') },
  ];

  const buttons = new Map();

  for (const option of options) {
    const isActive = option.key === selectedVisibility;
    const btn = createElement('button', {
      class: `visibility-filter-btn${isActive ? ' is-active' : ''}`,
      type: 'button',
      'data-visibility': option.key || 'all',
      onclick: () => {
        if (selectedVisibility === option.key) return;
        selectedVisibility = option.key;
        updateActiveState();
        onFilterChange?.(selectedVisibility);
      },
      text: option.label(),
    });
    buttons.set(option.key, btn);
    el.append(btn);
  }

  function updateActiveState() {
    for (const [key, btn] of buttons) {
      btn.classList.toggle('is-active', key === selectedVisibility);
    }
  }

  function getValue() {
    return selectedVisibility;
  }

  function clearFilter() {
    if (selectedVisibility === null) return;
    selectedVisibility = null;
    updateActiveState();
    onFilterChange?.(null);
  }

  return {
    el,
    getValue,
    clearFilter,
    detach: () => {},
  };
}
