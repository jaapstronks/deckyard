/**
 * Monotype / fonts.com panel for font editor.
 * Allows configuring a fonts.com project for font loading.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Create the Monotype panel.
 * @param {Object} options
 * @param {Object} options.sourceConfig - Current source_config
 * @param {Function} options.onChange - Called when config changes
 * @returns {{ el: HTMLElement, getConfig: Function }}
 */
export function createMonotypePanel({ sourceConfig = {}, onChange }) {
  const el = h('div', { class: 'font-source-panel' });

  const desc = h('p', {
    class: 'help',
    text: t(
      'fonts.monotypeHelp',
      'Enter your fonts.com (Monotype) project ID and the CSS font-family name. The project ID can be found in your fonts.com Web Fonts project settings.'
    ),
  });

  const fields = h('div', { class: 'font-editor-fields' });

  // Project ID
  const projectField = h('div', { class: 'stack' });
  projectField.append(
    h('label', { class: 'field-label', text: t('fonts.monotypeProjectId', 'Project ID') })
  );
  const projectInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    value: sourceConfig.projectId || '',
    oninput: () => {
      if (onChange) onChange(getConfig());
    },
  });
  projectField.append(projectInput);

  // Version
  const versionField = h('div', { class: 'stack' });
  versionField.append(
    h('label', { class: 'field-label', text: t('fonts.monotypeVersion', 'Version (optional)') })
  );
  const versionInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: '3',
    value: sourceConfig.version || '',
    oninput: () => {
      if (onChange) onChange(getConfig());
    },
  });
  versionField.append(versionInput);

  fields.append(projectField, versionField);
  el.append(desc, fields);

  function getConfig() {
    const config = {};
    const pid = projectInput.value.trim();
    if (pid) config.projectId = pid;
    const ver = versionInput.value.trim();
    if (ver) config.version = ver;
    return config;
  }

  return { el, getConfig };
}
