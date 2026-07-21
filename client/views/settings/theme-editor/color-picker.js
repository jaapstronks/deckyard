/**
 * Color Picker Component
 * Color input with hex text input.
 */

import { h } from '../../../lib/dom.js';
import { isValidHexColor, normalizeHex } from '../../../lib/theme/color-utils.js';

/**
 * Create a color picker component.
 * @param {Object} options
 * @param {string} options.label - Field label
 * @param {string} options.value - Initial hex color value
 * @param {Function} options.onChange - Change callback
 * @returns {Object} { el, getValue, setValue }
 */
export function createColorPicker({ label, value, onChange }) {
  const container = h('div', { class: 'theme-color-picker' });

  const labelEl = h('label', { class: 'theme-color-picker-label', text: label });

  const inputsRow = h('div', { class: 'theme-color-picker-inputs row gap-2' });

  // Color input (native picker)
  const colorInput = h('input', {
    class: 'theme-color-picker-color',
    type: 'color',
    value: normalizeHex(value) || '#000000',
    oninput: (e) => {
      const color = e.target.value;
      textInput.value = color;
      if (onChange) onChange(color);
    },
  });

  // Text input for manual hex entry
  const textInput = h('input', {
    class: 'input theme-color-picker-text',
    type: 'text',
    value: value || '#000000',
    placeholder: '#000000',
    maxlength: '7',
    oninput: (e) => {
      let val = e.target.value.trim();

      // Auto-add # prefix
      if (val && !val.startsWith('#')) {
        val = '#' + val;
        e.target.value = val;
      }

      // Update color picker if valid
      if (isValidHexColor(val)) {
        const normalized = normalizeHex(val);
        if (normalized) {
          colorInput.value = normalized;
          if (onChange) onChange(normalized);
        }
      }
    },
    onblur: (e) => {
      const val = e.target.value.trim();
      if (isValidHexColor(val)) {
        const normalized = normalizeHex(val);
        if (normalized) {
          e.target.value = normalized;
          colorInput.value = normalized;
        }
      } else {
        // Reset to color picker value
        e.target.value = colorInput.value;
      }
    },
  });

  inputsRow.append(colorInput, textInput);
  container.append(labelEl, inputsRow);

  return {
    el: container,
    getValue: () => textInput.value,
    setValue: (v) => {
      const normalized = normalizeHex(v);
      if (normalized) {
        textInput.value = normalized;
        colorInput.value = normalized;
      }
    },
  };
}
