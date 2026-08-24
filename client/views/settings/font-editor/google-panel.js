/**
 * Google Fonts panel for font editor.
 * Allows adding non-curated Google Fonts by name.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import {
  ensureGoogleFontPreview,
  googleFontFamily,
} from '../../../lib/theme/font-assets.js';

/**
 * Create the Google Fonts panel.
 * @param {Object} options
 * @param {Object} options.sourceConfig - Current source_config
 * @param {Function} options.onChange - Called when config changes
 * @returns {{ el: HTMLElement, getConfig: Function }}
 */
export function createGooglePanel({ sourceConfig = {}, onChange }) {
  const el = h('div', { class: 'font-source-panel' });

  const desc = h('p', {
    class: 'help',
    text: t(
      'fonts.googleHelp',
      'Add Google Fonts beyond the curated list. Enter the exact font family name from fonts.google.com.',
    ),
  });

  const fields = h('div', { class: 'stack' });

  // Spec (family name with optional weights)
  const specField = h('div', { class: 'stack' });
  specField.append(
    h('label', {
      class: 'field-label',
      text: t('fonts.googleSpec', 'Google Fonts specification'),
    }),
  );
  const specInput = h('input', {
    class: 'form-input',
    type: 'text',
    placeholder: 'Raleway:400,700',
    value: sourceConfig.spec || '',
    oninput: () => {
      if (onChange) onChange(getConfig());
      loadPreview();
    },
  });
  const specHint = h('div', {
    class: 'help',
    text: t(
      'fonts.googleSpecHint',
      'Use format "Family Name:weights", e.g. "Raleway:400,700" or just "Raleway".',
    ),
  });
  specField.append(specInput, specHint);

  // Preview
  const preview = h('div', { class: 'font-preview-text' });
  preview.textContent = t(
    'common.pangram',
    'The quick brown fox jumps over the lazy dog',
  );

  function loadPreview() {
    const family = googleFontFamily(specInput.value.trim());
    if (!family) return;
    ensureGoogleFontPreview(family);
    preview.style.fontFamily = `'${family}', sans-serif`;
  }

  fields.append(specField, preview);
  el.append(desc, fields);

  // Initial preview load
  loadPreview();

  function getConfig() {
    const spec = specInput.value.trim();
    return spec ? { spec } : {};
  }

  return { el, getConfig };
}
