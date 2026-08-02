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

