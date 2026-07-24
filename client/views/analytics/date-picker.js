/**
 * Date range picker for analytics.
 */

import { t } from '../../lib/ui-i18n.js';

/**
 * Get preset date ranges.
 * @returns {Array}
 */
function getPresets() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return [
    {
      label: t('analytics.last7Days', 'Last 7 days'),
      value: '7d',
      getRange: () => {
        const since = new Date(today);
        since.setDate(since.getDate() - 7);
        return { since: since.toISOString().split('T')[0], until: today.toISOString().split('T')[0] };
      },
    },
    {
      label: t('analytics.last30Days', 'Last 30 days'),
      value: '30d',
      getRange: () => {
        const since = new Date(today);
        since.setDate(since.getDate() - 30);
        return { since: since.toISOString().split('T')[0], until: today.toISOString().split('T')[0] };
      },
    },
    {
      label: t('analytics.last90Days', 'Last 90 days'),
      value: '90d',
      getRange: () => {
        const since = new Date(today);
        since.setDate(since.getDate() - 90);
        return { since: since.toISOString().split('T')[0], until: today.toISOString().split('T')[0] };
      },
    },
    {
      label: t('analytics.thisMonth', 'This month'),
      value: 'month',
      getRange: () => {
        const since = new Date(now.getFullYear(), now.getMonth(), 1);
        return { since: since.toISOString().split('T')[0], until: today.toISOString().split('T')[0] };
      },
    },
    {
      label: t('analytics.allTime', 'All time'),
      value: 'all',
      getRange: () => ({ since: null, until: null }),
    },
  ];
}

/**
 * Create date picker component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Object} options.initialRange - Initial date range
 * @param {Function} options.onChange - Change callback
 * @returns {Object} Picker API with el
 */
export function createDatePicker({ h, initialRange, onChange }) {
  const presets = getPresets();
  let currentPreset = '30d';
  let isOpen = false;

  const el = h('div', { class: 'analytics-date-picker' });

  // Button showing current selection
  const button = h('button', {
    class: 'btn btn-secondary analytics-date-picker-btn',
    onclick: () => toggleDropdown(),
    onkeydown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!isOpen) {
          toggleDropdown();
          // Focus first preset after opening
          setTimeout(() => focusPreset(0), 0);
        }
      }
    },
  });
  updateButtonText();

  // Dropdown
  const dropdown = h('div', { class: 'analytics-date-picker-dropdown', style: 'display: none;' });

  // Preset buttons
  const presetList = h('div', { class: 'analytics-date-picker-presets', role: 'listbox' });
  presets.forEach((preset, index) => {
    const btn = h('button', {
      class: `analytics-date-picker-preset ${preset.value === currentPreset ? 'is-active' : ''}`,
      text: preset.label,
      role: 'option',
      'aria-selected': preset.value === currentPreset ? 'true' : 'false',
      tabindex: index === 0 ? '0' : '-1',
      onclick: () => selectPreset(preset),
      onkeydown: (e) => handlePresetKeydown(e, index),
    });
    presetList.append(btn);
  });
  dropdown.append(presetList);

  // Custom range inputs
  const customRange = h('div', { class: 'analytics-date-picker-custom' }, [
    h('label', { text: t('analytics.customRange', 'Custom range') }),
    h('div', { class: 'analytics-date-picker-inputs' }, [
      h('input', {
        type: 'date',
        class: 'form-input analytics-date-input',
        value: initialRange?.since || '',
        onchange: (e) => {
          const since = e.target.value;
          const until = dropdown.querySelector('.analytics-date-input:last-child')?.value;
          if (since && until) {
            applyCustomRange(since, until);
          }
        },
      }),
      h('span', { text: '–' }),
      h('input', {
        type: 'date',
        class: 'form-input analytics-date-input',
        value: initialRange?.until || '',
        onchange: (e) => {
          const until = e.target.value;
          const since = dropdown.querySelector('.analytics-date-input')?.value;
          if (since && until) {
            applyCustomRange(since, until);
          }
        },
      }),
    ]),
  ]);
  dropdown.append(customRange);

  el.append(button, dropdown);

  // Close dropdown on outside click
  function handleOutsideClick(e) {
    if (!el.contains(e.target)) {
      closeDropdown();
    }
  }

  function toggleDropdown() {
    isOpen = !isOpen;
    dropdown.style.display = isOpen ? 'block' : 'none';
    if (isOpen) {
      document.addEventListener('click', handleOutsideClick);
      document.addEventListener('keydown', handleEscapeKey);
    } else {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleEscapeKey);
    }
  }

  function closeDropdown() {
    isOpen = false;
    dropdown.style.display = 'none';
    document.removeEventListener('click', handleOutsideClick);
    document.removeEventListener('keydown', handleEscapeKey);
    button.focus();
  }

  /**
   * Handle escape key to close dropdown.
   * @param {KeyboardEvent} e
   */
  function handleEscapeKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    }
  }

  /**
   * Handle keyboard navigation in presets.
   * @param {KeyboardEvent} e
   * @param {number} index
   */
  function handlePresetKeydown(e, index) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusPreset(Math.min(index + 1, presets.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusPreset(Math.max(index - 1, 0));
        break;
      case 'Escape':
        e.preventDefault();
        closeDropdown();
        break;
      case 'Home':
        e.preventDefault();
        focusPreset(0);
        break;
      case 'End':
        e.preventDefault();
        focusPreset(presets.length - 1);
        break;
    }
  }

  /**
   * Focus a preset by index.
   * @param {number} index
   */
  function focusPreset(index) {
    const buttons = presetList.querySelectorAll('.analytics-date-picker-preset');
    if (buttons[index]) {
      buttons.forEach((btn, i) => {
        btn.tabIndex = i === index ? 0 : -1;
      });
      buttons[index].focus();
    }
  }

  function selectPreset(preset) {
    currentPreset = preset.value;
    const range = preset.getRange();
    updateButtonText(preset.label);
    updatePresetButtons();
    closeDropdown();
    onChange?.(range);
  }

  function applyCustomRange(since, until) {
    currentPreset = 'custom';
    updateButtonText(`${since} – ${until}`);
    updatePresetButtons();
    closeDropdown();
    onChange?.({ since, until });
  }

  function updateButtonText(text) {
    const preset = presets.find((p) => p.value === currentPreset);
    button.textContent = text || preset?.label || t('analytics.selectRange', 'Select range');
    button.append(h('span', { class: 'analytics-date-picker-arrow', text: ' ▾' }));
  }

  function updatePresetButtons() {
    presetList.querySelectorAll('.analytics-date-picker-preset').forEach((btn, i) => {
      btn.classList.toggle('is-active', presets[i].value === currentPreset);
    });
  }

  return { el };
}