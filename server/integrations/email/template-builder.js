/**
 * Template building helpers for emails.
 */

import {
  resolveTemplate,
  interpolatePlaceholders,
} from '../email-template-resolver.js';
import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { TEMPLATE_METADATA } from '../../storage/email-templates.js';
import {
  EMAIL_STYLES,
  emailButton,
  emailWrapper,
  stripTags,
  troubleClickingFooter,
} from '../email-templates/index.js';
import { sendEmail } from './core.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('email');

/**
 * Try to send an email using a custom template if available.
 * Returns the send result if a custom template was used, or null to fall back to defaults.
 *
 * @param {Object} options
 * @param {string|null} options.repoRoot - Repository root for custom template resolution
 * @param {string} options.templateType - Template type identifier
 * @param {string} options.locale - Locale code
 * @param {Object} options.vars - Variables for placeholder interpolation
 * @param {string} options.actionUrl - URL for the action button
 * @param {Object} options.emailOpts - Email options (to, toName)
 * @returns {Promise<{ok: boolean, status?: number, error?: string}|null>}
 */
export async function trySendCustomTemplate({
  repoRoot,
  templateType,
  locale,
  vars,
  actionUrl,
  emailOpts,
}) {
  if (!repoRoot) return null;

  // An unknown template type is a programmer error (a sender referencing a type
  // that isn't in the canonical list), not a transient failure — log it loudly
  // instead of letting the catch-all below swallow it silently.
  if (!TEMPLATE_METADATA[templateType]) {
    log.error(
      `Unknown email template type "${templateType}"; falling back to code default`,
    );
    return null;
  }

  try {
    const resolved = await resolveTemplate(repoRoot, templateType, locale);
    if (!resolved.isCustom) return null;

    // A mail subject is a plain-text header, not an HTML sink — the code
    // defaults interpolate it through the translator, which escapes nothing.
    // Escaping here is what put `&#039;` in front of every O'Brien.
    const subject = interpolatePlaceholders(
      resolved.fields.subject || '',
      vars,
      false,
    );
    const { htmlContent, textContent } = buildFromResolvedTemplate(
      resolved.fields,
      vars,
      actionUrl,
    );

    return sendEmail({
      ...emailOpts,
      subject,
      htmlContent,
      textContent,
    });
  } catch (err) {
    // Custom override unavailable or a transport hiccup: fall back to the code
    // default. These are expected at runtime, so warn rather than error.
    log.warn(
      `Custom template "${templateType}" unavailable, using default:`,
      err.message,
    );
    return null;
  }
}

/**
 * Build an email from resolved template fields.
 * @param {Object} fields - Resolved template fields
 * @param {Object} vars - Variables for placeholder interpolation
 * @param {string} actionUrl - URL for the action button
 * @returns {{ htmlContent: string, textContent: string }}
 */
export function buildFromResolvedTemplate(fields, vars, actionUrl) {
  // Escape exactly once, at the point of insertion. `emailWrapper`,
  // `emailButton` and the muted paragraph below each escape their whole string,
  // so these three are interpolated raw — pre-escaping them here escaped the
  // escape, and a recipient called O'Brien read `O&#039;Brien` in the greeting.
  // `body` is the exception: it is admin-authored markup and goes in unescaped,
  // so a value interpolated into it has to be escaped here or nowhere.
  const greeting = interpolatePlaceholders(fields.greeting || '', vars, false);
  const body = interpolatePlaceholders(fields.body || '', vars);
  // The text/plain half is not an HTML sink either, so it takes raw values
  // throughout: strip the admin's markup first, then interpolate.
  const bodyText = interpolatePlaceholders(
    stripTags(fields.body || ''),
    vars,
    false,
  );
  const buttonLabel = interpolatePlaceholders(
    fields.buttonLabel || '',
    vars,
    false,
  );
  const footer = interpolatePlaceholders(fields.footer || '', vars, false);

  const htmlContent = emailWrapper({
    greeting,
    body: `
      <p>${body}</p>
      ${emailButton(actionUrl, buttonLabel)}
      <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(footer)}</p>
    `,
    footer: troubleClickingFooter(actionUrl),
  });

  const textContent = `
${greeting}

${bodyText}

${actionUrl}

${footer}
`.trim();

  return { htmlContent, textContent };
}
