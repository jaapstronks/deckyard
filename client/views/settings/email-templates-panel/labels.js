/**
 * Email Templates Panel - Label Helpers
 * Provides i18n-aware labels for template types, locales, and fields.
 */

import { t } from '../../../lib/ui-i18n.js';
import {
  TEMPLATE_TYPES,
  SUPPORTED_LOCALES,
  TEMPLATE_FIELDS,
} from '../../../../shared/constants/email-templates.js';

// Re-export constants for convenience
export { TEMPLATE_TYPES, SUPPORTED_LOCALES, TEMPLATE_FIELDS };

/**
 * Get template type label with i18n support.
 * @param {string} type - Template type identifier
 * @returns {string} Human-readable label
 */
export function getTemplateLabel(type) {
  const labels = {
    userInvitation: t('settings.admin.emailTemplates.types.userInvitation', 'User Invitation'),
    activationReminder: t('settings.admin.emailTemplates.types.activationReminder', 'Activation Reminder'),
    collaboratorInvite: t('settings.admin.emailTemplates.types.collaboratorInvite', 'Collaborator Invitation'),
    guestInvitation: t('settings.admin.emailTemplates.types.guestInvitation', 'Guest Invitation'),
    passwordReset: t('settings.admin.emailTemplates.types.passwordReset', 'Password Reset'),
    magicLink: t('settings.admin.emailTemplates.types.magicLink', 'Magic Link'),
    commentNotification: t('settings.admin.emailTemplates.types.commentNotification', 'Comment Notification'),
    guestVerification: t('settings.admin.emailTemplates.types.guestVerification', 'Guest Verification'),
  };
  return labels[type] || type;
}

/**
 * Get locale label with i18n support.
 * @param {string} locale - Locale code
 * @returns {string} Human-readable label
 */
export function getLocaleLabel(locale) {
  const labels = {
    en: t('settings.admin.emailTemplates.locales.en', 'English'),
    nl: t('settings.admin.emailTemplates.locales.nl', 'Nederlands'),
    de: t('settings.admin.emailTemplates.locales.de', 'Deutsch'),
    fr: t('settings.admin.emailTemplates.locales.fr', 'Francais'),
    es: t('settings.admin.emailTemplates.locales.es', 'Espanol'),
    pt: t('settings.admin.emailTemplates.locales.pt', 'Portugues'),
    da: t('settings.admin.emailTemplates.locales.da', 'Dansk'),
    sv: t('settings.admin.emailTemplates.locales.sv', 'Svenska'),
    no: t('settings.admin.emailTemplates.locales.no', 'Norsk'),
  };
  return labels[locale] || locale;
}

/**
 * Get field label with i18n support.
 * @param {string} field - Field name
 * @returns {string} Human-readable label
 */
export function getFieldLabel(field) {
  const labels = {
    subject: t('settings.admin.emailTemplates.fields.subject', 'Subject'),
    greeting: t('settings.admin.emailTemplates.fields.greeting', 'Greeting'),
    body: t('settings.admin.emailTemplates.fields.body', 'Body'),
    buttonLabel: t('settings.admin.emailTemplates.fields.buttonLabel', 'Button Label'),
    footer: t('settings.admin.emailTemplates.fields.footer', 'Footer'),
  };
  return labels[field] || field;
}