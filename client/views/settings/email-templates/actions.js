/**
 * Email Templates Panel - Actions
 * Event handlers and async operations.
 */

import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import {
  fetchEmailTemplates,
  updateEmailTemplate,
  resetEmailTemplate,
  updateEmailDefaultLocale,
  previewEmailTemplate,
  sendTestEmail,
} from '../../../lib/net/settings.js';

/**
 * Create actions for the email templates panel.
 * @param {Object} state - State management object
 * @param {Object} elements - UI elements
 * @param {Function} rebuildUI - Function to rebuild UI after data changes
 * @returns {Object} Action functions
 */
export function createActions(state, elements, rebuildUI) {
  const {
    previewContainer,
    previewFrame,
    defaultLocaleSelect,
    defaultLocaleError,
    saveError,
  } = elements;

  /**
   * Load template data from server.
   */
  const loadData = async () => {
    try {
      state.setBusy(true);
      const data = await fetchEmailTemplates({ maxAgeMs: 0 });
      state.setData(data);
      rebuildUI();
    } catch (err) {
      toast.error(err, { id: 'email-templates-load' });
    } finally {
      state.setBusy(false);
    }
  };

  /**
   * Handle template type selection change.
   * @param {string} type - New template type
   */
  const onTemplateTypeChange = (type) => {
    // The refusal named the form that is about to be replaced, so it goes with
    // it — a message about the template you just left is worse than none.
    saveError.clear();
    state.setCurrentType(type);
    rebuildUI();
    previewContainer.style.display = 'none';
  };

  /**
   * Handle locale tab change.
   * @param {string} locale - New locale
   */
  const onLocaleChange = (locale) => {
    saveError.clear();
    state.setCurrentLocale(locale);
    rebuildUI();
    previewContainer.style.display = 'none';
  };

  /**
   * Handle default locale change.
   */
  const onDefaultLocaleChange = async () => {
    const locale = defaultLocaleSelect.value;
    defaultLocaleError.clear();
    try {
      state.setBusy(true);
      await updateEmailDefaultLocale(locale);
      toast.success(
        t(
          'settings.admin.emailTemplates.defaultLocaleSaved',
          'Default language updated.',
        ),
        { id: 'email-templates-save', durationMs: 2000 },
      );
    } catch (err) {
      const data = state.getData();
      defaultLocaleSelect.value = data?.defaultLocale || 'en';
      // The select is the control that was refused, and the value has just
      // snapped back to what the server still holds — so the sentence belongs
      // underneath it, not in a toast that leaves the reversal unexplained.
      defaultLocaleError.show(err.message, { control: defaultLocaleSelect });
    } finally {
      state.setBusy(false);
    }
  };

  /**
   * Save current template customizations.
   */
  const onSave = async () => {
    if (state.isBusy()) return;
    saveError.clear();
    const fields = state.getFormValues();

    try {
      state.setBusy(true);
      await updateEmailTemplate(
        state.getCurrentType(),
        state.getCurrentLocale(),
        fields,
      );
      const data = await fetchEmailTemplates({ maxAgeMs: 0 });
      state.setData(data);
      rebuildUI();
      toast.success(
        t('settings.admin.emailTemplates.saved', 'Template saved.'),
        { id: 'email-templates-save', durationMs: 2000 },
      );
    } catch (err) {
      // `rebuildUI()` rewrites the form inputs on every state change, so the
      // refusal names the form as a whole rather than a control that may no
      // longer be the one the user typed in.
      saveError.show(err.message);
    } finally {
      state.setBusy(false);
    }
  };

  /**
   * Reset template to defaults.
   */
  const onReset = async () => {
    if (state.isBusy()) return;

    const confirmed = await confirmModal(document.body, {
      title: t('settings.admin.emailTemplates.resetTitle', 'Reset to default'),
      message: t(
        'settings.admin.emailTemplates.resetConfirm',
        'Reset this template to the default? This will remove all customizations for this language.',
      ),
      confirmLabel: t(
        'settings.admin.emailTemplates.resetTitle',
        'Reset to default',
      ),
      danger: true,
    });
    if (!confirmed) return;

    try {
      state.setBusy(true);
      await resetEmailTemplate(
        state.getCurrentType(),
        state.getCurrentLocale(),
      );
      const data = await fetchEmailTemplates({ maxAgeMs: 0 });
      state.setData(data);
      rebuildUI();
      previewContainer.style.display = 'none';
      toast.success(
        t('settings.admin.emailTemplates.reset', 'Template reset to default.'),
        { id: 'email-templates-save', durationMs: 2000 },
      );
    } catch (err) {
      toast.error(err, { id: 'email-templates-save' });
    } finally {
      state.setBusy(false);
    }
  };

  /**
   * Show preview of current template.
   */
  const onPreview = async () => {
    if (state.isBusy()) return;
    const fields = state.getFormValues();

    try {
      state.setBusy(true);
      const resp = await previewEmailTemplate(
        state.getCurrentType(),
        state.getCurrentLocale(),
        Object.keys(fields).length > 0 ? fields : null,
      );
      if (resp?.preview?.htmlContent) {
        // srcdoc into a sandbox="" frame: the document renders exactly as the
        // mail client will see it, in an opaque origin that cannot reach this
        // page, its cookies or its DOM.
        previewFrame.srcdoc = resp.preview.htmlContent;
        previewContainer.style.display = '';
      }
    } catch (err) {
      toast.error(err, {
        id: 'email-templates-preview',
      });
    } finally {
      state.setBusy(false);
    }
  };

  /**
   * Send test email.
   */
  const onSendTest = async () => {
    if (state.isBusy()) return;
    const fields = state.getFormValues();

    try {
      state.setBusy(true);
      const resp = await sendTestEmail(
        state.getCurrentType(),
        state.getCurrentLocale(),
        Object.keys(fields).length > 0 ? fields : null,
      );
      toast.success(
        resp?.message ||
          t('settings.admin.emailTemplates.testSent', 'Test email sent.'),
        { id: 'email-templates-test', durationMs: 3000 },
      );
    } catch (err) {
      toast.error(err, { id: 'email-templates-test' });
    } finally {
      state.setBusy(false);
    }
  };

  return {
    loadData,
    onTemplateTypeChange,
    onLocaleChange,
    onDefaultLocaleChange,
    onSave,
    onReset,
    onPreview,
    onSendTest,
  };
}
