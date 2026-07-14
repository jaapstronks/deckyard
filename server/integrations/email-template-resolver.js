/**
 * Email Template Resolver
 * Merges admin-customized templates with code defaults.
 * Provides fallback chain: custom override -> code default -> 'en' default
 */

import { createTranslator } from '../i18n/index.js';
import {
  readEmailTemplates,
  getEmailTemplateOverride,
  TEMPLATE_METADATA,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from '../storage/email-templates.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * @typedef {import('../storage/email-templates.js').TemplateType} TemplateType
 * @typedef {import('../storage/email-templates.js').SupportedLocale} SupportedLocale
 * @typedef {import('../storage/email-templates.js').TemplateField} TemplateField
 */

/**
 * @typedef {Object} ResolvedTemplateFields
 * @property {string} subject - Email subject line
 * @property {string} greeting - Opening greeting
 * @property {string} body - Main email body content
 * @property {string} buttonLabel - Call-to-action button text
 * @property {string} footer - Footer text (typically expiration info)
 */

/**
 * @typedef {Object} ResolvedTemplate
 * @property {TemplateType} type - Template type identifier
 * @property {SupportedLocale} locale - Resolved locale code
 * @property {boolean} isCustom - Whether any custom overrides are applied
 * @property {ResolvedTemplateFields} fields - Resolved field values
 */

/**
 * @typedef {Object} TemplatePreview
 * @property {TemplateType} type - Template type identifier
 * @property {SupportedLocale} locale - Locale code
 * @property {string} subject - Interpolated subject line
 * @property {string} greeting - Interpolated greeting
 * @property {string} body - Interpolated body content
 * @property {string} buttonLabel - Interpolated button text
 * @property {string} footer - Interpolated footer text
 * @property {Object.<string, string>} sampleData - Sample data used for interpolation
 */

/**
 * @typedef {Object} LocaleTemplateInfo
 * @property {boolean} isCustom - Whether custom overrides exist
 * @property {Object.<TemplateField, string>} override - Custom override values
 * @property {Object.<TemplateField, string>} defaults - Code default values
 */

/**
 * @typedef {Object} AllTemplatesResult
 * @property {SupportedLocale} defaultLocale - Default locale setting
 * @property {SupportedLocale[]} supportedLocales - List of supported locales
 * @property {Object.<TemplateType, { label: string, description: string, placeholders: Array, locales: Object.<SupportedLocale, LocaleTemplateInfo> }>} templates - All templates with metadata and resolved values
 */

// ============================================================
// I18N MAPPING
// ============================================================

/**
 * Mapping from template type to i18n key prefixes and default values.
 * @type {Object.<TemplateType, Object.<TemplateField, [string, string]>>}
 */
const TEMPLATE_I18N_MAP = {
  userInvitation: {
    subject: ['email.userInvitation.subject', "You've been invited to join"],
    greeting: ['email.common.greeting', 'Hi {name},'],
    body: ['email.userInvitation.body', '{inviter} has invited you to join. Click the button below to set up your account:'],
    buttonLabel: ['email.userInvitation.button', 'Set Up Your Account'],
    footer: ['email.userInvitation.expiry', 'This invitation expires in 7 days.'],
  },
  activationReminder: {
    subject: ['email.activationReminder.subject', 'Reminder: Complete your account setup'],
    greeting: ['email.common.greeting', 'Hi {name},'],
    body: ['email.activationReminder.body', "We noticed you haven't completed your account setup yet. {inviter} invited you to join — click the button below to get started:"],
    buttonLabel: ['email.activationReminder.button', 'Complete Setup'],
    footer: ['email.activationReminder.expiry', 'This invitation link is still valid.'],
  },
  collaboratorInvite: {
    subject: ['email.collaboratorInvite.subject', '{inviter} shared "{presTitle}" with you'],
    greeting: ['email.common.greeting', 'Hi {name},'],
    body: ['email.collaboratorInvite.body', '<strong>{inviter}</strong> has invited you to {permission} <strong>{presTitle}</strong>.'],
    buttonLabel: ['email.collaboratorInvite.button', 'Open Presentation'],
    footer: ['email.collaboratorInvite.access', 'You now have {accessLevel} to this presentation.'],
  },
  guestInvitation: {
    subject: ['email.guestInvitation.subject', '{inviter} invited you to view "{presTitle}"'],
    greeting: ['email.common.greeting', 'Hi {name},'],
    body: ['email.guestInvitation.body', '<strong>{inviter}</strong> has invited you to view and comment on their presentation <strong>{presTitle}</strong>.'],
    buttonLabel: ['email.guestInvitation.button', 'View Presentation'],
    footer: ['email.guestInvitation.footer', "You'll be asked to verify your email address when you access the presentation."],
  },
  passwordReset: {
    subject: ['email.passwordReset.subject', 'Reset your password'],
    greeting: ['email.common.greeting', 'Hi {name},'],
    body: ['email.passwordReset.body', 'We received a request to reset your password. Click the button below to choose a new password:'],
    buttonLabel: ['email.passwordReset.button', 'Reset Password'],
    footer: ['email.passwordReset.expiry', "This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email."],
  },
  magicLink: {
    subject: ['email.magicLink.subject', 'Your sign-in link'],
    greeting: ['email.common.greetingAnonymous', 'Hi there,'],
    body: ['email.magicLink.body', 'Click the button below to sign in. No password needed!'],
    buttonLabel: ['email.magicLink.button', 'Sign in now'],
    footer: ['email.magicLink.expiry', 'This link expires in 15 minutes and can only be used once.'],
  },
  commentNotification: {
    subject: ['email.commentNotification.subject.new', 'New comment on "{presTitle}"'],
    greeting: ['email.common.greetingAnonymous', 'Hi there,'],
    body: ['email.commentNotification.body.new', 'commented on your presentation'],
    buttonLabel: ['email.commentNotification.action.new', 'View and reply'],
    footer: ['email.commentNotification.footer.owner', 'This notification was sent because you own this presentation.'],
  },
  guestVerification: {
    subject: ['email.guestVerification.subject', 'Verify your email to comment on "{presTitle}"'],
    greeting: ['email.common.greeting', 'Hi {name},'],
    body: ['email.guestVerification.body', 'Click the link below to verify your email and join the discussion on <strong>{presTitle}</strong>:'],
    buttonLabel: ['email.guestVerification.button', 'Verify Email & Join Discussion'],
    footer: ['email.guestVerification.expiry', 'This link expires in 24 hours.'],
  },
  leadNotification: {
    subject: ['email.leadNotification.subject', 'New lead from "{presTitle}"'],
    greeting: ['email.common.greetingAnonymous', 'Hi there,'],
    body: ['email.leadNotification.body', 'A new lead was captured from your presentation <strong>{presTitle}</strong>:'],
    buttonLabel: ['email.leadNotification.button', 'View All Leads'],
    footer: ['email.leadNotification.footer', 'You received this notification because you have lead email notifications enabled.'],
  },
};

/**
 * Interpolate placeholders in a string.
 * @param {string} str - String with {placeholder} syntax
 * @param {Object} vars - Variables to interpolate
 * @param {boolean} escapeValues - Whether to HTML-escape values
 * @returns {string} Interpolated string
 */
export function interpolatePlaceholders(str, vars, escapeValues = true) {
  if (!vars || typeof vars !== 'object') return str;
  return String(str).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
    const value = String(vars[name]);
    return escapeValues ? escapeHtml(value) : value;
  });
}

/**
 * Get the code default value for a template field.
 * @param {string} type - Template type
 * @param {string} field - Field name
 * @param {string} locale - Locale code
 * @returns {string} Default value from i18n
 */
export function getCodeDefault(type, field, locale) {
  const map = TEMPLATE_I18N_MAP[type];
  if (!map || !map[field]) return '';

  const [key, fallback] = map[field];
  const tr = createTranslator(locale);
  return tr(key, fallback);
}

/**
 * Resolve a template field value.
 * Priority: custom override -> code default (requested locale) -> code default (en)
 * @param {string} repoRoot - Repository root directory
 * @param {string} type - Template type
 * @param {string} field - Field name
 * @param {string} locale - Requested locale
 * @returns {Promise<string>} Resolved field value
 */
export async function resolveTemplateField(repoRoot, type, field, locale) {
  // Try custom override for requested locale
  const override = await getEmailTemplateOverride(repoRoot, type, locale);
  if (override && override[field]) {
    return override[field];
  }

  // Fall back to code default for requested locale
  const codeDefault = getCodeDefault(type, field, locale);
  if (codeDefault) {
    return codeDefault;
  }

  // Fall back to English code default
  if (locale !== DEFAULT_LOCALE) {
    return getCodeDefault(type, field, DEFAULT_LOCALE);
  }

  return '';
}

/**
 * Resolve a complete template with all fields.
 * @param {string} repoRoot - Repository root directory
 * @param {TemplateType} type - Template type
 * @param {string} locale - Requested locale
 * @returns {Promise<ResolvedTemplate>} Resolved template with all fields
 */
export async function resolveTemplate(repoRoot, type, locale) {
  if (!TEMPLATE_METADATA[type]) {
    throw new Error(`Invalid template type: ${type}`);
  }

  const normalizedLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  const fields = TEMPLATE_METADATA[type].fields;
  const result = {
    type,
    locale: normalizedLocale,
    isCustom: false,
    fields: {},
  };

  // Get override to check if any custom values exist
  const override = await getEmailTemplateOverride(repoRoot, type, normalizedLocale);
  if (override && Object.keys(override).length > 0) {
    result.isCustom = true;
  }

  // Resolve each field
  for (const field of fields) {
    result.fields[field] = await resolveTemplateField(repoRoot, type, field, normalizedLocale);
  }

  return result;
}

/**
 * Get all templates with their resolved values for all locales.
 * Used by the admin UI to show all templates at once.
 * @param {string} repoRoot - Repository root directory
 * @returns {Promise<AllTemplatesResult>} All templates with metadata and resolved values
 */
export async function getAllTemplates(repoRoot) {
  const data = await readEmailTemplates(repoRoot);
  const result = {
    defaultLocale: data.defaultLocale,
    supportedLocales: SUPPORTED_LOCALES,
    templates: {},
  };

  for (const type of Object.keys(TEMPLATE_METADATA)) {
    result.templates[type] = {
      ...TEMPLATE_METADATA[type],
      locales: {},
    };

    for (const locale of SUPPORTED_LOCALES) {
      const override = data.templates[type]?.[locale];
      const hasOverride = override && Object.keys(override).length > 0;

      // Get code defaults for this locale
      const codeDefaults = {};
      for (const field of TEMPLATE_METADATA[type].fields) {
        codeDefaults[field] = getCodeDefault(type, field, locale);
      }

      result.templates[type].locales[locale] = {
        isCustom: hasOverride,
        override: override || {},
        defaults: codeDefaults,
      };
    }
  }

  return result;
}

/**
 * Generate a preview of an email with sample data.
 * @param {string} repoRoot - Repository root directory
 * @param {TemplateType} type - Template type
 * @param {string} locale - Locale code
 * @param {Object.<TemplateField, string>|null} customFields - Optional custom fields to preview (not yet saved)
 * @returns {Promise<TemplatePreview>} Preview with interpolated subject and body
 */
export async function generatePreview(repoRoot, type, locale, customFields = null) {
  if (!TEMPLATE_METADATA[type]) {
    throw new Error(`Invalid template type: ${type}`);
  }

  // Sample data for each template type
  const sampleData = {
    userInvitation: {
      name: 'Alex',
      inviter: 'Jordan Smith',
    },
    activationReminder: {
      name: 'Alex',
      inviter: 'Jordan Smith',
    },
    collaboratorInvite: {
      name: 'Alex',
      inviter: 'Jordan Smith',
      presTitle: 'Q4 Marketing Strategy',
      permission: 'edit',
      accessLevel: 'full editing access',
    },
    guestInvitation: {
      name: 'Alex',
      inviter: 'Jordan Smith',
      presTitle: 'Q4 Marketing Strategy',
    },
    passwordReset: {
      name: 'Alex',
    },
    magicLink: {},
    commentNotification: {
      commenterName: 'Jordan Smith',
      presTitle: 'Q4 Marketing Strategy',
      commentBody: 'This looks great! Can we add more data on the competitor analysis?',
    },
    guestVerification: {
      name: 'Alex',
      presTitle: 'Q4 Marketing Strategy',
    },
    leadNotification: {
      presTitle: 'Q4 Marketing Strategy',
      leadName: 'Sam Johnson',
      leadEmail: 'sam.johnson@example.com',
      submittedAt: 'Jan 24, 2026, 2:35 PM',
    },
  };

  const vars = sampleData[type] || {};
  const resolved = await resolveTemplate(repoRoot, type, locale);

  // Apply custom fields if provided (for preview before saving)
  const fields = { ...resolved.fields };
  if (customFields && typeof customFields === 'object') {
    for (const [key, value] of Object.entries(customFields)) {
      if (typeof value === 'string' && value.trim()) {
        fields[key] = value;
      }
    }
  }

  return {
    type,
    locale,
    subject: interpolatePlaceholders(fields.subject || '', vars, false),
    greeting: interpolatePlaceholders(fields.greeting || '', vars, false),
    body: interpolatePlaceholders(fields.body || '', vars, false),
    buttonLabel: interpolatePlaceholders(fields.buttonLabel || '', vars, false),
    footer: interpolatePlaceholders(fields.footer || '', vars, false),
    sampleData: vars,
  };
}