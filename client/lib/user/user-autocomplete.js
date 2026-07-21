/**
 * User autocomplete component with multi-select capability.
 * Searches users by email or name with debounced input.
 */

import { h, installDismissOnOutside } from '../dom.js';
import { t } from '../ui-i18n.js';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 1;

/**
 * Create a user autocomplete component.
 * @param {Object} options
 * @param {Function} options.api - API call function
 * @param {string[]} [options.excludeEmails=[]] - Emails to exclude from results
 * @param {Function} [options.onSelectionChange] - Callback when selection changes
 * @param {string} [options.placeholder] - Input placeholder
 * @returns {Object} { el, getSelected, clear, setExcludeEmails, detach }
 */
export function createUserAutocomplete({
  api,
  excludeEmails = [],
  onSelectionChange,
  placeholder,
}) {
  let selected = [];
  let results = [];
  let highlightIndex = -1;
  let isOpen = false;
  let isLoading = false;
  let debounceTimer = null;
  let currentExclude = [...excludeEmails];

  // Container
  const container = h('div', { class: 'user-autocomplete' });

  // Selected users chips
  const chipsContainer = h('div', { class: 'user-autocomplete-chips' });

  // Input wrapper
  const inputWrapper = h('div', { class: 'user-autocomplete-input-wrapper' });

  const input = h('input', {
    type: 'text',
    class: 'form-input user-autocomplete-input',
    placeholder: placeholder || t('userAutocomplete.placeholder', 'Search users...'),
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  });

  const loadingIndicator = h('span', {
    class: 'user-autocomplete-loading',
    text: '',
  });

  inputWrapper.append(input, loadingIndicator);

  // Dropdown
  const dropdown = h('div', { class: 'user-autocomplete-dropdown' });

  container.append(chipsContainer, inputWrapper, dropdown);

  // Install dismiss handler
  const detachDismiss = installDismissOnOutside({
    rootEl: container,
    isOpen: () => isOpen,
    close: () => closeDropdown(),
    returnFocusEl: input,
  });

  function renderChips() {
    chipsContainer.innerHTML = '';
    for (const user of selected) {
      const chip = h('div', { class: 'user-autocomplete-chip' }, [
        h('span', {
          class: 'user-autocomplete-chip-text',
          text: user.name || user.email,
        }),
        h('button', {
          class: 'user-autocomplete-chip-remove',
          type: 'button',
          text: '\u00d7',
          title: t('userAutocomplete.remove', 'Remove'),
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeUser(user.email);
          },
        }),
      ]);
      chipsContainer.append(chip);
    }
  }

  function renderDropdown() {
    dropdown.innerHTML = '';

    if (isLoading) {
      dropdown.append(
        h('div', {
          class: 'user-autocomplete-item is-loading',
          text: t('userAutocomplete.loading', 'Searching...'),
        })
      );
      return;
    }

    if (results.length === 0 && input.value.trim().length >= MIN_QUERY_LENGTH) {
      dropdown.append(
        h('div', {
          class: 'user-autocomplete-item is-empty',
          text: t('userAutocomplete.noResults', 'No users found'),
        })
      );
      return;
    }

    results.forEach((user, index) => {
      const item = h('div', {
        class: `user-autocomplete-item${index === highlightIndex ? ' is-highlighted' : ''}`,
        'data-email': user.email,
        onclick: () => selectUser(user),
        onmouseenter: () => {
          highlightIndex = index;
          updateHighlight();
        },
      });

      const info = h('div', { class: 'user-autocomplete-item-info' });
      if (user.name) {
        info.append(h('div', { class: 'user-autocomplete-item-name', text: user.name }));
      }
      info.append(h('div', { class: 'user-autocomplete-item-email', text: user.email }));
      item.append(info);

      dropdown.append(item);
    });
  }

  function updateHighlight() {
    const items = dropdown.querySelectorAll('.user-autocomplete-item:not(.is-loading):not(.is-empty)');
    items.forEach((item, i) => {
      item.classList.toggle('is-highlighted', i === highlightIndex);
    });
  }

  function openDropdown() {
    if (isOpen) return;
    isOpen = true;
    dropdown.classList.add('is-open');
  }

  function closeDropdown() {
    if (!isOpen) return;
    isOpen = false;
    dropdown.classList.remove('is-open');
    highlightIndex = -1;
  }

  function selectUser(user) {
    if (selected.some((u) => u.email === user.email)) return;

    selected = [...selected, user];
    renderChips();
    input.value = '';
    results = [];
    closeDropdown();
    input.focus();
    onSelectionChange?.(selected);
  }

  function removeUser(email) {
    selected = selected.filter((u) => u.email !== email);
    renderChips();
    onSelectionChange?.(selected);
  }

  async function search(query) {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      results = [];
      closeDropdown();
      return;
    }

    isLoading = true;
    loadingIndicator.classList.add('is-visible');
    openDropdown();
    renderDropdown();

    try {
      // Build exclude list: initial excludes + currently selected
      const allExclude = [
        ...currentExclude,
        ...selected.map((u) => u.email),
      ].filter(Boolean);

      const excludeParam = allExclude.length > 0 ? `&exclude=${encodeURIComponent(allExclude.join(','))}` : '';
      const resp = await api(`/api/users/search?q=${encodeURIComponent(trimmed)}&limit=10${excludeParam}`);
      results = resp?.users || [];
      highlightIndex = results.length > 0 ? 0 : -1;
    } catch (e) {
      results = [];
      // eslint-disable-next-line no-console
      console.error('[user-autocomplete] search error:', e);
    } finally {
      isLoading = false;
      loadingIndicator.classList.remove('is-visible');
      renderDropdown();
    }
  }

  function debouncedSearch(query) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      search(query);
    }, DEBOUNCE_MS);
  }

  // Event handlers
  input.addEventListener('input', () => {
    debouncedSearch(input.value);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= MIN_QUERY_LENGTH) {
      openDropdown();
      renderDropdown();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' && input.value.trim().length >= MIN_QUERY_LENGTH) {
        openDropdown();
        renderDropdown();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (highlightIndex < results.length - 1) {
          highlightIndex++;
          updateHighlight();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (highlightIndex > 0) {
          highlightIndex--;
          updateHighlight();
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < results.length) {
          selectUser(results[highlightIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeDropdown();
        break;
      case 'Backspace':
        if (input.value === '' && selected.length > 0) {
          // Remove last selected user
          removeUser(selected[selected.length - 1].email);
        }
        break;
    }
  });

  // Public API
  return {
    el: container,
    getSelected: () => [...selected],
    clear: () => {
      selected = [];
      results = [];
      input.value = '';
      highlightIndex = -1;
      renderChips();
      closeDropdown();
      onSelectionChange?.(selected);
    },
    setExcludeEmails: (emails) => {
      currentExclude = [...emails];
    },
    focus: () => input.focus(),
    detach: () => {
      detachDismiss();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    },
  };
}