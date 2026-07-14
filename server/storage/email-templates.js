/**
 * Email template storage layer.
 * Provides CRUD operations for admin-customizable email templates.
 * Templates are stored in data/email-templates.json as instance-level overrides.
 * Code defaults remain in server/i18n/locales/*.json.
 */

import path from 'node:path';
import { readJsonIfExists, writeJsonAtomic } from './io.js';
import { dataDir } from '../config/storage-paths.js';
import {
  SUPPORTED_LOCALES as SHARED_SUPPORTED_LOCALES,
  DEFAULT_LOCALE as SHARED_DEFAULT_LOCALE,
  TEMPLATE_FIELDS,
} from '../../shared/constants/email-templates.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * @typedef {'userInvitation' | 'activationReminder' | 'collaboratorInvite' | 'guestInvitation' | 'passwordReset' | 'magicLink' | 'commentNotification' | 'guestVerification' | 'leadNotification'} TemplateType
 * Valid email template type identifiers.
 */

/**
 * @typedef {'en' | 'nl' | 'de' | 'fr' | 'es' | 'pt' | 'da' | 'sv' | 'no'} SupportedLocale
 * Supported locale codes for email templates.
 */

/**
 * @typedef {'subject' | 'greeting' | 'body' | 'buttonLabel' | 'footer'} TemplateField
 * Available fields in an email template.
 */

/**
 * @typedef {Object} TemplatePlaceholder
 * @property {string} key - Placeholder key (e.g., 'name', 'inviter')
 * @property {string} description - Human-readable description of the placeholder
 */

/**
 * @typedef {Object} TemplateMetadataEntry
 * @property {string} label - Human-readable label for the template type
 * @property {string} description - Description of when this template is sent
 * @property {TemplatePlaceholder[]} placeholders - Available placeholders for this template
 * @property {TemplateField[]} fields - Template fields that can be customized
 */

/**
 * @typedef {Object.<TemplateType, TemplateMetadataEntry>} TemplateMetadataMap
 * Complete mapping of template types to their metadata.
 */

/**
 * @typedef {Object.<TemplateField, string>} TemplateFieldOverrides
 * Override values for template fields.
 */

/**
 * @typedef {Object.<SupportedLocale, TemplateFieldOverrides>} TemplateLocaleOverrides
 * Override values keyed by locale.
 */

/**
 * @typedef {Object} EmailTemplatesConfig
 * @property {SupportedLocale} defaultLocale - Default locale for emails when none specified
 * @property {Object.<TemplateType, TemplateLocaleOverrides>} templates - Template overrides by type and locale
 */

// ============================================================
// METADATA CONSTANTS
// ============================================================

/**
 * Template type metadata with available placeholders.
 * Used for UI documentation and validation.
 * @type {TemplateMetadataMap}
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
 * Supported locales for email templates.
 * Re-exported from shared constants for server-side use.
 */
export const SUPPORTED_LOCALES = SHARED_SUPPORTED_LOCALES;

/**
 * Default locale for email templates.
 * Re-exported from shared constants for server-side use.
 */
export const DEFAULT_LOCALE = SHARED_DEFAULT_LOCALE;

/**
 * Get the path to the email templates file.
 * @param {string} repoRoot - Repository root directory
 * @returns {string} Path to email-templates.json
 */
function emailTemplatesPath(repoRoot) {
  return path.join(dataDir(repoRoot), 'email-templates.json');
}

/**
 * Read all email template overrides.
 * @param {string} repoRoot - Repository root directory
 * @returns {Promise<Object>} Email templates configuration
 */
export async function readEmailTemplates(repoRoot) {
  const raw = await readJsonIfExists(emailTemplatesPath(repoRoot));
  const obj = raw && typeof raw === 'object' ? raw : {};

  return {
    defaultLocale: typeof obj.defaultLocale === 'string' && SUPPORTED_LOCALES.includes(obj.defaultLocale)
      ? obj.defaultLocale
      : DEFAULT_LOCALE,
    templates: obj.templates && typeof obj.templates === 'object' ? obj.templates : {},
  };
}

/**
 * Write email template override for a specific type and locale.
 * @param {string} repoRoot - Repository root directory
 * @param {string} type - Template type (e.g., 'userInvitation')
 * @param {string} locale - Locale code (e.g., 'en')
 * @param {Object} fields - Template fields to save
 * @returns {Promise<Object>} Updated templates configuration
 */
export async function writeEmailTemplate(repoRoot, type, locale, fields) {
  // Validate type
  if (!TEMPLATE_METADATA[type]) {
    throw new Error(`Invalid template type: ${type}`);
  }

  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }

  const current = await readEmailTemplates(repoRoot);

  // Initialize template type if not exists
  if (!current.templates[type]) {
    current.templates[type] = {};
  }

  // Normalize and validate fields
  const allowedFields = TEMPLATE_METADATA[type].fields;
  const normalized = {};

  for (const field of allowedFields) {
    if (typeof fields[field] === 'string') {
      const trimmed = fields[field].trim();
      if (trimmed) {
        normalized[field] = trimmed;
      }
    }
  }

  // Only save if there are actual overrides
  if (Object.keys(normalized).length > 0) {
    current.templates[type][locale] = normalized;
  } else {
    // Remove locale if no fields
    delete current.templates[type][locale];
    // Remove type if no locales
    if (Object.keys(current.templates[type]).length === 0) {
      delete current.templates[type];
    }
  }

  await writeJsonAtomic(emailTemplatesPath(repoRoot), current);
  return current;
}

/**
 * Delete email template override for a specific type and locale.
 * Resets to code defaults.
 * @param {string} repoRoot - Repository root directory
 * @param {string} type - Template type (e.g., 'userInvitation')
 * @param {string} locale - Locale code (e.g., 'en')
 * @returns {Promise<Object>} Updated templates configuration
 */
export async function deleteEmailTemplate(repoRoot, type, locale) {
  // Validate type
  if (!TEMPLATE_METADATA[type]) {
    throw new Error(`Invalid template type: ${type}`);
  }

  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }

  const current = await readEmailTemplates(repoRoot);

  // Remove locale override
  if (current.templates[type]) {
    delete current.templates[type][locale];
    // Remove type if no locales
    if (Object.keys(current.templates[type]).length === 0) {
      delete current.templates[type];
    }
  }

  await writeJsonAtomic(emailTemplatesPath(repoRoot), current);
  return current;
}

/**
 * Update the default locale setting.
 * @param {string} repoRoot - Repository root directory
 * @param {string} locale - New default locale
 * @returns {Promise<Object>} Updated templates configuration
 */
export async function updateDefaultLocale(repoRoot, locale) {
  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }

  const current = await readEmailTemplates(repoRoot);
  current.defaultLocale = locale;

  await writeJsonAtomic(emailTemplatesPath(repoRoot), current);
  return current;
}

/**
 * Get template override for a specific type and locale.
 * @param {string} repoRoot - Repository root directory
 * @param {string} type - Template type
 * @param {string} locale - Locale code
 * @returns {Promise<Object|null>} Template override or null if not set
 */
export async function getEmailTemplateOverride(repoRoot, type, locale) {
  const data = await readEmailTemplates(repoRoot);
  return data.templates[type]?.[locale] || null;
}

/**
 * Get the configured default locale for email templates.
 * Used when sending user invitation emails without a specified locale.
 * @param {string} repoRoot - Repository root directory
 * @returns {Promise<string>} Default locale code
 */
export async function getEmailDefaultLocale(repoRoot) {
  const data = await readEmailTemplates(repoRoot);
  return data.defaultLocale || DEFAULT_LOCALE;
}