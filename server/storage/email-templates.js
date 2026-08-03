/**
 * Email template storage layer.
 * Provides CRUD operations for admin-customizable email templates.
 * Overrides are instance-level and persist in PostgreSQL: one row per
 * (type, locale) in `email_templates`, and the instance default locale in the
 * singleton `email_template_settings` (see migration 058). Code defaults remain
 * in server/i18n/locales/*.json.
 *
 * The facade is unchanged from the file-backed version — every function still
 * takes `repoRoot` first for call-site stability — but that argument is now
 * unused: persistence no longer touches disk.
 */

import { sql } from 'kysely';
import { withDbGuard } from './utils/db-guard.js';
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
 * Empty configuration, returned when the database is unavailable so callers see
 * the code defaults rather than an error.
 * @returns {EmailTemplatesConfig}
 */
function emptyConfig() {
  return { defaultLocale: DEFAULT_LOCALE, templates: {} };
}

/**
 * Read all email template overrides plus the instance default locale.
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @returns {Promise<Object>} Email templates configuration
 */
export async function getEmailTemplates(repoRoot) {
  return withDbGuard(emptyConfig(), async (db) => {
    const [rows, settings] = await Promise.all([
      db.selectFrom('email_templates').select(['type', 'locale', 'fields']).execute(),
      db.selectFrom('email_template_settings').select('default_locale').executeTakeFirst(),
    ]);

    const templates = {};
    for (const row of rows) {
      if (!templates[row.type]) templates[row.type] = {};
      // jsonb reads back as a parsed object; guard against a null column.
      templates[row.type][row.locale] = row.fields || {};
    }

    const defaultLocale =
      settings && SUPPORTED_LOCALES.includes(settings.default_locale)
        ? settings.default_locale
        : DEFAULT_LOCALE;

    return { defaultLocale, templates };
  });
}

/**
 * Normalize submitted fields to the type's allowed set: trimmed non-empty
 * strings only. Returns a plain object (possibly empty).
 * @param {string} type
 * @param {Object} fields
 * @returns {Object}
 */
function normalizeFields(type, fields) {
  const allowedFields = TEMPLATE_METADATA[type].fields;
  const normalized = {};
  for (const field of allowedFields) {
    if (typeof fields[field] === 'string') {
      const trimmed = fields[field].trim();
      if (trimmed) normalized[field] = trimmed;
    }
  }
  return normalized;
}

/**
 * Write email template override for a specific type and locale. An override
 * that normalizes to no fields deletes the row (mirrors the old file
 * semantics, where an empty entry was removed).
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @param {string} type - Template type (e.g., 'userInvitation')
 * @param {string} locale - Locale code (e.g., 'en')
 * @param {Object} fields - Template fields to save
 * @returns {Promise<Object>} Updated templates configuration
 */
export async function writeEmailTemplate(repoRoot, type, locale, fields) {
  if (!TEMPLATE_METADATA[type]) {
    throw new Error(`Invalid template type: ${type}`);
  }
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }

  const normalized = normalizeFields(type, fields);

  return withDbGuard(emptyConfig(), async (db) => {
    if (Object.keys(normalized).length > 0) {
      await db
        .insertInto('email_templates')
        .values({ type, locale, fields: JSON.stringify(normalized), updated_at: sql`now()` })
        .onConflict((oc) =>
          oc.columns(['type', 'locale']).doUpdateSet({
            fields: JSON.stringify(normalized),
            updated_at: sql`now()`,
          })
        )
        .execute();
    } else {
      await db
        .deleteFrom('email_templates')
        .where('type', '=', type)
        .where('locale', '=', locale)
        .execute();
    }
    return getEmailTemplates(repoRoot);
  });
}

/**
 * Delete email template override for a specific type and locale.
 * Resets to code defaults.
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @param {string} type - Template type (e.g., 'userInvitation')
 * @param {string} locale - Locale code (e.g., 'en')
 * @returns {Promise<Object>} Updated templates configuration
 */
export async function deleteEmailTemplate(repoRoot, type, locale) {
  if (!TEMPLATE_METADATA[type]) {
    throw new Error(`Invalid template type: ${type}`);
  }
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }

  return withDbGuard(emptyConfig(), async (db) => {
    await db
      .deleteFrom('email_templates')
      .where('type', '=', type)
      .where('locale', '=', locale)
      .execute();
    return getEmailTemplates(repoRoot);
  });
}

/**
 * Update the instance default locale setting (upserts the singleton row).
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @param {string} locale - New default locale
 * @returns {Promise<Object>} Updated templates configuration
 */
export async function updateDefaultLocale(repoRoot, locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }

  return withDbGuard(emptyConfig(), async (db) => {
    await db
      .insertInto('email_template_settings')
      .values({ id: true, default_locale: locale, updated_at: sql`now()` })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({ default_locale: locale, updated_at: sql`now()` })
      )
      .execute();
    return getEmailTemplates(repoRoot);
  });
}

/**
 * Get template override for a specific type and locale.
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @param {string} type - Template type
 * @param {string} locale - Locale code
 * @returns {Promise<Object|null>} Template override or null if not set
 */
export async function getEmailTemplateOverride(repoRoot, type, locale) {
  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('email_templates')
      .select('fields')
      .where('type', '=', type)
      .where('locale', '=', locale)
      .executeTakeFirst();
    return row?.fields || null;
  });
}

/**
 * Get the configured default locale for email templates.
 * Used when sending user invitation emails without a specified locale.
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @returns {Promise<string>} Default locale code
 */
export async function getEmailDefaultLocale(repoRoot) {
  return withDbGuard(DEFAULT_LOCALE, async (db) => {
    const row = await db
      .selectFrom('email_template_settings')
      .select('default_locale')
      .executeTakeFirst();
    return row && SUPPORTED_LOCALES.includes(row.default_locale)
      ? row.default_locale
      : DEFAULT_LOCALE;
  });
}