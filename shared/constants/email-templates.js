/**
 * Shared email template constants.
 * Used by both client (admin panel) and server (template resolution).
 */

/**
 * All available email template types.
 * @type {string[]}
 */
export const TEMPLATE_TYPES = [
  'userInvitation',
  'activationReminder',
  'collaboratorInvite',
  'guestInvitation',
  'passwordReset',
  'magicLink',
  'commentNotification',
  'guestVerification',
];

/**
 * Supported locales for email templates.
 * @type {string[]}
 */
export const SUPPORTED_LOCALES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'da', 'sv', 'no'];

/**
 * Default locale for email templates.
 * @type {string}
 */
export const DEFAULT_LOCALE = 'en';

/**
 * Template fields that can be customized.
 * @type {string[]}
 */
export const TEMPLATE_FIELDS = ['subject', 'greeting', 'body', 'buttonLabel', 'footer'];

/**
 * Human-readable labels for template types.
 * Used in admin UI dropdowns and headers.
 * @type {Object.<string, string>}
 */
export const TEMPLATE_TYPE_LABELS = {
  userInvitation: 'User Invitation',
  activationReminder: 'Activation Reminder',
  collaboratorInvite: 'Collaborator Invitation',
  guestInvitation: 'Guest Invitation',
  passwordReset: 'Password Reset',
  magicLink: 'Magic Link',
  commentNotification: 'Comment Notification',
  guestVerification: 'Guest Email Verification',
};

/**
 * Human-readable labels for locales.
 * @type {Object.<string, string>}
 */
export const LOCALE_LABELS = {
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
  fr: 'Fran\u00e7ais',
  es: 'Espa\u00f1ol',
  pt: 'Portugu\u00eas',
  da: 'Dansk',
  sv: 'Svenska',
  no: 'Norsk',
};

/**
 * Human-readable labels for template fields.
 * @type {Object.<string, string>}
 */
export const FIELD_LABELS = {
  subject: 'Subject',
  greeting: 'Greeting',
  body: 'Body',
  buttonLabel: 'Button Label',
  footer: 'Footer',
};