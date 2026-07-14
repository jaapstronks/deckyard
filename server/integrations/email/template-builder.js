/**
 * Template building helpers for emails.
 */

import { resolveTemplate, interpolatePlaceholders } from '../email-template-resolver.js';
import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import {
  EMAIL_STYLES,
  emailButton,
  emailWrapper,
  troubleClickingFooter,
} from '../email-templates.js';
import { sendEmail } from './core.js';

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
export async function trySendCustomTemplate({ repoRoot, templateType, locale, vars, actionUrl, emailOpts }) {
  if (!repoRoot) return null;

  try {
    const resolved = await resolveTemplate(repoRoot, templateType, locale);
    if (!resolved.isCustom) return null;

    const subject = interpolatePlaceholders(resolved.fields.subject || '', vars);
    const { htmlContent, textContent } = buildFromResolvedTemplate(resolved.fields, vars, actionUrl);

    return sendEmail({
      ...emailOpts,
      subject,
      htmlContent,
      textContent,
    });
  } catch {
    // Fall through to default behavior
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
  const greeting = interpolatePlaceholders(fields.greeting || '', vars);
  const body = interpolatePlaceholders(fields.body || '', vars);
  const buttonLabel = interpolatePlaceholders(fields.buttonLabel || '', vars);
  const footer = interpolatePlaceholders(fields.footer || '', vars);

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

${body.replace(/<[^>]*>/g, '')}

${actionUrl}

${footer}
`.trim();

  return { htmlContent, textContent };
}
