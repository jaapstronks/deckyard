/**
 * Shared email template constants.
 * Used by both client (admin panel) and server (template resolution).
 */

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
 * Metadata for every admin-customizable email template type: the single source
 * of truth. The UI (`TEMPLATE_TYPES`), the server API validation and the
 * template resolver all derive from this object — there is no second
 * hand-maintained list. Adding a type here makes it selectable in the admin
 * panel and acceptable to the API; the resolver additionally requires a code
 * default in its `TEMPLATE_I18N_MAP` (guarded by
 * tests/email-template-types-consistency.test.js).
 *
 * @typedef {Object} TemplatePlaceholder
 * @property {string} key - Placeholder key (e.g., 'name', 'inviter')
 * @property {string} description - Human-readable description of the placeholder
 *
 * @typedef {Object} TemplateMetadataEntry
 * @property {string} label - Human-readable label for the template type
 * @property {string} description - Description of when this template is sent
 * @property {TemplatePlaceholder[]} placeholders - Available placeholders
 * @property {string[]} fields - Template fields that can be customized
 *
 * @type {Object.<string, TemplateMetadataEntry>}
 */
export const TEMPLATE_METADATA = {
  userInvitation: {
    label: 'User Invitation',
    description: 'Sent when inviting a new user to the system',
    placeholders: [
      { key: 'name', description: 'Recipient name' },
      { key: 'inviter', description: 'Name of person who sent the invite' },
    ],
    fields: TEMPLATE_FIELDS,
  },
  activationReminder: {
    label: 'Activation Reminder',
    description: 'Sent as a reminder to users who have not yet activated their account',
    placeholders: [
      { key: 'name', description: 'Recipient name' },
      { key: 'inviter', description: 'Name of person who sent the original invite' },
    ],
    fields: TEMPLATE_FIELDS,
  },
  collaboratorInvite: {
    label: 'Collaborator Invitation',
    description: 'Sent when sharing a presentation with a collaborator',
    placeholders: [
      { key: 'name', description: 'Recipient name' },
      { key: 'inviter', description: 'Name of person who shared' },
      { key: 'presTitle', description: 'Presentation title' },
      { key: 'permission', description: 'Permission level (view/comment/edit)' },
      { key: 'accessLevel', description: 'Access level description' },
    ],
    fields: TEMPLATE_FIELDS,
  },
  guestInvitation: {
    label: 'Guest Invitation',
    description: 'Sent when inviting a guest to view a presentation',
    placeholders: [
      { key: 'name', description: 'Recipient name' },
      { key: 'inviter', description: 'Name of person who sent the invite' },
      { key: 'presTitle', description: 'Presentation title' },
    ],
    fields: TEMPLATE_FIELDS,
  },
  passwordReset: {
    label: 'Password Reset',
    description: 'Sent when a user requests to reset their password',
    placeholders: [
      { key: 'name', description: 'Recipient name' },
    ],
    fields: TEMPLATE_FIELDS,
  },
  magicLink: {
    label: 'Magic Link',
    description: 'Sent for passwordless sign-in',
    placeholders: [],
    fields: TEMPLATE_FIELDS,
  },
  commentNotification: {
    label: 'Comment Notification',
    description: 'Sent when someone comments on a presentation',
    placeholders: [
      { key: 'commenterName', description: 'Name of the commenter' },
      { key: 'presTitle', description: 'Presentation title' },
      { key: 'commentBody', description: 'Comment text' },
    ],
    fields: TEMPLATE_FIELDS,
  },
  guestVerification: {
    label: 'Guest Email Verification',
    description: 'Sent to verify guest email before commenting',
    placeholders: [
      { key: 'name', description: 'Recipient name' },
      { key: 'presTitle', description: 'Presentation title' },
    ],
    fields: TEMPLATE_FIELDS,
  },
  leadNotification: {
    label: 'Lead Notification',
    description: 'Sent to presentation owner when a lead is captured',
    placeholders: [
      { key: 'presTitle', description: 'Presentation title' },
      { key: 'leadName', description: 'Name of the lead' },
      { key: 'leadEmail', description: 'Email of the lead' },
      { key: 'submittedAt', description: 'Submission date/time' },
    ],
    fields: TEMPLATE_FIELDS,
  },
};

/**
 * All available email template types, derived from {@link TEMPLATE_METADATA} so
 * there is exactly one list to maintain.
 * @type {string[]}
 */
export const TEMPLATE_TYPES = Object.keys(TEMPLATE_METADATA);

