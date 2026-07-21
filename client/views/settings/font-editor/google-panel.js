/**
 * Google Fonts panel for font editor.
 * Allows adding non-curated Google Fonts by name.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';

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
      'Add Google Fonts beyond the curated list. Enter the exact font family name from fonts.google.com.'
    ),
  });

  const fields = h('div', { class: 'stack' });

  // Spec (family name with optional weights)
  const specField = h('div', { class: 'stack' });
  specField.append(
    h('label', {
      class: 'field-label',
      text: t('fonts.googleSpec', 'Google Fonts specification'),
    })
  );
  const specInput = h('input', {
    class: 'input',
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
      'Use format "Family Name:weights", e.g. "Raleway:400,700" or just "Raleway".'
    ),
  });
  specField.append(specInput, specHint);

  // Preview
  const preview = h('div', { class: 'font-preview-text' });
  preview.textContent = t('common.pangram', 'The quick brown fox jumps over the lazy dog');

  function loadPreview() {
    const spec = specInput.value.trim();
    if (!spec) return;
    const family = spec.split(':')[0].trim();
    if (!family) return;

    // Load Google Font for preview
    const linkId = `google-font-preview-${family.replace(/\s+/g, '-').toLowerCase()}`;
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;600;700&display=swap`;
      document.head.appendChild(link);
    }
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
