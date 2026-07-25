/**
 * Admin Email Templates Panel
 * Allows admins to customize email templates per locale.
 *
 * Module structure:
 * - labels.js - i18n label helpers
 * - state.js - State management
 * - builders.js - UI building functions
 * - actions.js - Event handlers and async operations
 */

import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom.js';
import { createState } from './state.js';
import {
  buildTemplateOptions,
  buildDefaultLocaleOptions,
  buildLocaleTabs,
  buildPlaceholders,
  buildForm,
} from './builders.js';
import { createActions } from './actions.js';

/**
 * Create the email templates panel.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {HTMLElement} Panel element
 */
export function createEmailTemplatesPanel({ user }) {
  if (!user?.isAdmin) {
    return h('div');
  }

  // Create panel structure
  const panel = h('div', { class: 'email-templates-panel stack editor-card' });

  const title = h('div', {
    class: 'field-label',
    text: t('settings.admin.emailTemplates.title', 'Admin: Email Templates'),
  });

  const hint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.emailTemplates.hint',
      'Customize email templates sent by the system. Changes override code defaults.'
    ),
  });

  // Default locale selector
  const defaultLocaleRow = h('div', { class: 'row', style: 'gap: 10px; align-items: center; margin-bottom: 16px;' });
  const defaultLocaleLabel = h('label', {
    text: t('settings.admin.emailTemplates.defaultLocale', 'Default language for new user invitations:'),
    style: 'font-weight: 500;',
  });
  const defaultLocaleSelect = h('select', { class: 'form-input', style: 'width: auto;' });
  defaultLocaleRow.append(defaultLocaleLabel, defaultLocaleSelect);

  // Template selector
  const templateRow = h('div', { class: 'row', style: 'gap: 10px; align-items: center; margin-bottom: 16px;' });
  const templateLabel = h('label', {
    text: t('settings.admin.emailTemplates.templateType', 'Template:'),
    style: 'font-weight: 500;',
  });
  const templateSelect = h('select', { class: 'form-input', style: 'width: auto; min-width: 200px;' });
  templateRow.append(templateLabel, templateSelect);

  // Locale tabs
  const localeTabs = h('div', { class: 'email-template-locale-tabs sb-segmented is-toggle', style: 'margin-bottom: 16px;' });

  // Form fields container
  const formContainer = h('div', { class: 'email-template-form', style: 'margin-bottom: 16px;' });

  // Placeholders sidebar
  const placeholdersContainer = h('div', { class: 'email-template-placeholders', style: 'margin-bottom: 16px;' });

  // Preview container
  const previewContainer = h('div', { class: 'email-template-preview', style: 'margin-bottom: 16px; display: none;' });
  const previewTitle = h('div', { class: 'field-label', text: t('settings.admin.emailTemplates.preview', 'Preview') });
  const previewContent = h('div', {
    class: 'email-preview-content',
    style: 'border: 1px solid var(--border-color); border-radius: 4px; padding: 16px; background: white; max-height: 400px; overflow: auto;',
  });
  previewContainer.append(previewTitle, previewContent);

  // Action buttons
  const actions = h('div', { class: 'row', style: 'gap: 10px; justify-content: space-between;' });
  const leftActions = h('div', { class: 'row', style: 'gap: 10px;' });
  const rightActions = h('div', { class: 'row', style: 'gap: 10px;' });

  const resetBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('settings.admin.emailTemplates.resetToDefault', 'Reset to Default'),
  });

  const previewBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('settings.admin.emailTemplates.previewBtn', 'Preview'),
  });

  const testBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('settings.admin.emailTemplates.sendTest', 'Send Test'),
  });

  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('common.save', 'Save'),
  });

  leftActions.append(resetBtn);
  rightActions.append(previewBtn, testBtn, saveBtn);
  actions.append(leftActions, rightActions);

  panel.append(
    title,
    hint,
    defaultLocaleRow,
    templateRow,
    localeTabs,
    formContainer,
    placeholdersContainer,
    previewContainer,
    actions
  );

  // Initialize state
  const elements = {
    templateSelect,
    defaultLocaleSelect,
    localeTabs,
    resetBtn,
    previewBtn,
    testBtn,
    saveBtn,
    previewContainer,
    previewContent,
  };

  const state = createState(elements);

  // Rebuild UI function (called after state changes)
  const rebuildUI = () => {
    const data = state.getData();
    const currentType = state.getCurrentType();
    const currentLocale = state.getCurrentLocale();

    buildTemplateOptions(templateSelect, currentType);
    buildDefaultLocaleOptions(defaultLocaleSelect, data);
    buildLocaleTabs(
      localeTabs,
      data,
      currentType,
      currentLocale,
      panelActions.onLocaleChange,
      () => state.isBusy()
    );

    const templateData = data?.templates?.[currentType];
    buildPlaceholders(placeholdersContainer, templateData?.placeholders);

    const formInputs = buildForm(formContainer, data, currentType, currentLocale);
    state.setFormInputs(formInputs);
  };

  // Initialize actions
  const panelActions = createActions(state, elements, rebuildUI);

  // Wire up event listeners
  templateSelect.addEventListener('change', () => {
    panelActions.onTemplateTypeChange(templateSelect.value);
  });

  defaultLocaleSelect.addEventListener('change', panelActions.onDefaultLocaleChange);
  saveBtn.addEventListener('click', panelActions.onSave);
  resetBtn.addEventListener('click', panelActions.onReset);
  previewBtn.addEventListener('click', panelActions.onPreview);
  testBtn.addEventListener('click', panelActions.onSendTest);

  // Initial load
  panelActions.loadData();

  return panel;
}