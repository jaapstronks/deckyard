import { t } from '../../../lib/ui-i18n.js';

/**
 * Color picker field for custom color selection.
 * Provides a native color input with hex display and preset swatches.
 */
export function createColorFields({ h } = {}) {
  // Common preset colors from the theme
  const PRESET_COLORS = [
    { value: '#7c3aed', label: t('editor.color.preset.purple', 'Purple') },
    { value: '#f5f5f5', label: t('editor.color.preset.mist', 'Mist') },
    { value: '#212121', label: t('editor.color.preset.dark', 'Dark') },
    { value: '#2563eb', label: t('editor.color.preset.blue', 'Blue') },
    { value: '#ffffff', label: t('editor.color.preset.white', 'White') },
    { value: '#000000', label: t('editor.color.preset.black', 'Black') },
  ];

  /**
   * Validate and normalize a hex color string.
   * Accepts 3 or 6 character hex (with or without #).
   * Returns normalized 6-character hex with # prefix, or empty string if invalid.
   */
  function normalizeHex(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return '';

    // Remove # prefix if present
    const hex = s.startsWith('#') ? s.slice(1) : s;

    // Validate hex characters
    if (!/^[0-9a-f]+$/i.test(hex)) return '';

    // Handle 3-character shorthand (e.g., #fff -> #ffffff)
    if (hex.length === 3) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }

    // Standard 6-character hex
    if (hex.length === 6) {
      return `#${hex}`;
    }

    return '';
  }

  /**
   * Color picker field with:
   * - Native color input for visual selection
   * - Text input for direct hex entry
   * - Preset color swatches
   */
  const fieldColor = (label, value, onChange, opts = {}) => {
    const normalized = normalizeHex(value) || '#ffffff';
    let currentValue = normalized;

    const wrap = h('div', { class: 'stack is-field color-field' });

    // Label
    const labelEl = h('div', { class: 'field-label', text: label });
    wrap.append(labelEl);

    // Color input row
    const inputRow = h('div', { class: 'color-field-inputs' });

    // Native color picker
    const colorInput = h('input', {
      type: 'color',
      class: 'color-picker-native',
      value: currentValue,
      title: t('editor.color.pickColor', 'Pick a color'),
    });

    // Hex text input
    const hexInput = h('input', {
      type: 'text',
      class: 'form-input color-hex-input',
      value: currentValue,
      placeholder: '#ffffff',
      maxLength: 7,
    });

    // Sync updates between inputs
    const updateValue = (newValue, source) => {
      const norm = normalizeHex(newValue);
      if (!norm) return;

      currentValue = norm;

      if (source !== 'color') {
        colorInput.value = norm;
      }
      if (source !== 'hex') {
        hexInput.value = norm;
      }

      onChange(norm);
    };

    colorInput.addEventListener('input', () => {
      updateValue(colorInput.value, 'color');
    });

    hexInput.addEventListener('input', () => {
      const norm = normalizeHex(hexInput.value);
      if (norm) {
        updateValue(norm, 'hex');
      }
    });

    hexInput.addEventListener('blur', () => {
      // On blur, validate and normalize
      const norm = normalizeHex(hexInput.value);
      if (norm) {
        hexInput.value = norm;
      } else {
        // Reset to current valid value
        hexInput.value = currentValue;
      }
    });

    inputRow.append(colorInput, hexInput);
    wrap.append(inputRow);

    // Preset swatches
    if (opts?.showPresets !== false) {
      const presetsRow = h('div', { class: 'color-presets' });

      for (const preset of PRESET_COLORS) {
        const swatch = h('button', {
          type: 'button',
          class: 'color-preset-swatch',
          title: preset.label,
          style: `--swatch-color: ${preset.value};`,
        });
        swatch.addEventListener('click', (e) => {
          e.preventDefault();
          updateValue(preset.value, 'preset');
        });
        presetsRow.append(swatch);
      }

      wrap.append(presetsRow);
    }

    // Help text
    const helpText = typeof opts?.helpText === 'string' ? opts.helpText : '';
    if (helpText) {
      wrap.append(h('div', { class: 'help', text: helpText }));
    }

    return wrap;
  };

  return { fieldColor };
}
