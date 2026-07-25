/**
 * Email Templates Panel - UI Builders
 * Functions for building and updating UI components.
 */

import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom.js';
import { getTemplateLabel, getLocaleLabel, getFieldLabel, TEMPLATE_TYPES } from './labels.js';

/**
 * Build template selector options.
 * @param {HTMLSelectElement} templateSelect - Select element
 * @param {string} currentType - Currently selected type
 */
export function buildTemplateOptions(templateSelect, currentType) {
  templateSelect.innerHTML = '';
  for (const type of TEMPLATE_TYPES) {
    const option = h('option', { value: type, text: getTemplateLabel(type) });
    templateSelect.append(option);
  }
  templateSelect.value = currentType;
}

/**
 * Build default locale selector options.
 * @param {HTMLSelectElement} defaultLocaleSelect - Select element
 * @param {Object} data - Template data from server
 */
export function buildDefaultLocaleOptions(defaultLocaleSelect, data) {
  defaultLocaleSelect.innerHTML = '';
  const locales = data?.supportedLocales || ['en'];
  for (const locale of locales) {
    const option = h('option', {
      value: locale,
      text: getLocaleLabel(locale),
    });
    defaultLocaleSelect.append(option);
  }
  defaultLocaleSelect.value = data?.defaultLocale || 'en';
}

/**
 * Build locale tabs with customization indicators.
 * @param {HTMLElement} localeTabs - Tabs container
 * @param {Object} data - Template data from server
 * @param {string} currentType - Currently selected type
 * @param {string} currentLocale - Currently selected locale
 * @param {Function} onLocaleChange - Callback when locale changes
 * @param {Function} isBusy - Function to check busy state
 */
export function buildLocaleTabs(localeTabs, data, currentType, currentLocale, onLocaleChange, isBusy) {
  localeTabs.innerHTML = '';
  const locales = data?.supportedLocales || ['en'];

  for (const locale of locales) {
    const templateData = data?.templates?.[currentType]?.locales?.[locale];
    const isCustom = templateData?.isCustom;

    const tab = h('button', {
      class: `sb-segmented-btn ${locale === currentLocale ? 'is-active' : ''}`,
      type: 'button',
      'data-locale': locale,
    });

    const label = h('span', { text: locale.toUpperCase() });
    if (isCustom) {
      const indicator = h('span', {
        text: ' *',
        title: t('settings.admin.emailTemplates.customized', 'Customized'),
        style: 'color: var(--color-primary);',
      });
      tab.append(label, indicator);
    } else {
      tab.append(label);
    }

    tab.addEventListener('click', () => {
      if (isBusy()) return;
      onLocaleChange(locale);
    });

    localeTabs.append(tab);
  }
}

/**
 * Build placeholders sidebar.
 * @param {HTMLElement} container - Placeholders container
 * @param {Array} placeholders - Placeholder definitions
 */
export function buildPlaceholders(container, placeholders) {
  container.innerHTML = '';

  if (!placeholders || placeholders.length === 0) return;

  const title = h('div', {
    class: 'field-label',
    text: t('settings.admin.emailTemplates.placeholders', 'Available Placeholders'),
  });

  const list = h('ul', { style: 'margin: 0; padding-left: 20px; color: var(--text-muted);' });

  for (const p of placeholders) {
    const li = h('li', { style: 'margin-bottom: 4px;' });
    const code = h('code', {
      text: `{${p.key}}`,
      style: 'background: var(--bg-muted); padding: 2px 6px; border-radius: 3px;',
    });
    const desc = h('span', { text: ` - ${p.description}`, style: 'font-size: 13px;' });
    li.append(code, desc);
    list.append(li);
  }

  container.append(title, list);
}

/**
 * Build form fields for template editing.
 * @param {HTMLElement} formContainer - Form container
 * @param {Object} data - Template data from server
 * @param {string} currentType - Currently selected type
 * @param {string} currentLocale - Currently selected locale
 * @returns {Object.<string, HTMLElement>} Map of field names to input elements
 */
export function buildForm(formContainer, data, currentType, currentLocale) {
  formContainer.innerHTML = '';
  const formInputs = {};

  const templateData = data?.templates?.[currentType];
  if (!templateData) return formInputs;

  const localeData = templateData.locales?.[currentLocale];
  const fields = templateData.fields || ['subject', 'greeting', 'body', 'buttonLabel', 'footer'];

  for (const field of fields) {
    const fieldWrap = h('div', { style: 'margin-bottom: 12px;' });

    const fieldLabel = h('label', {
      class: 'field-label',
      text: getFieldLabel(field),
      style: 'margin-bottom: 4px; display: block;',
    });

    // Get current value (override or default)
    const override = localeData?.override?.[field] || '';
    const defaultValue = localeData?.defaults?.[field] || '';
    const value = override || '';
    const placeholder = defaultValue || '';

    let input;
    if (field === 'body') {
      input = h('textarea', {
        class: 'form-input',
        rows: 4,
        value,
        placeholder,
        style: 'width: 100%;',
      });
    } else {
      input = h('input', {
        class: 'form-input',
        type: 'text',
        value,
        placeholder,
        style: 'width: 100%;',
      });
    }

    formInputs[field] = input;

    const fieldHint = h('div', {
      class: 'help',
      text: override
        ? t('settings.admin.emailTemplates.fieldCustomized', 'Using custom value')
        : t('settings.admin.emailTemplates.fieldDefault', 'Using default (type to customize)'),
      style: override ? 'color: var(--color-primary);' : '',
    });

    input.addEventListener('input', () => {
      const hasValue = input.value.trim() !== '';
      fieldHint.textContent = hasValue
        ? t('settings.admin.emailTemplates.fieldCustomized', 'Using custom value')
        : t('settings.admin.emailTemplates.fieldDefault', 'Using default (type to customize)');
      fieldHint.style.color = hasValue ? 'var(--color-primary)' : '';
    });

    fieldWrap.append(fieldLabel, input, fieldHint);
    formContainer.append(fieldWrap);
  }

  return formInputs;
}