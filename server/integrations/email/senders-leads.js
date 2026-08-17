/**
 * Lead capture email senders.
 */

import { buildLeadNotificationEmail, buildDataRequestEmail } from '../email-templates/index.js';
import { sendEmail, getSenderIdentity } from './core.js';
import { getUserSettings } from '../../storage/settings.js';
import { resolveTemplate, interpolatePlaceholders } from '../email-template-resolver.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import { createLogger } from '../../utils/logger.js';
import { envStr } from '../../config/utils.js';
import { createTranslator } from '../../i18n/index.js';

const log = createLogger('email');

/**
 * Send a lead notification email to the presentation owner.
 * Checks user preferences before sending.
 * @param {string} repoRoot - Repository root path
 * @param {Object} options
 * @param {Object} options.presentation - Presentation object
 * @param {Object} options.lead - Lead object with name, email, submittedAt
 */
export async function maybeSendLeadNotification(repoRoot, { presentation, lead }) {
  if (!repoRoot || !presentation || !lead) return;

  const ownerEmail = presentation.createdBy || presentation.owner;
  if (!ownerEmail) return;

  // Check if user has lead notifications enabled
  const userSettings = await getUserSettings(
    crossOrganizationScope(repoRoot ?? null, 'lead notification: owner e-mail preference'),
    ownerEmail
  );
  if (!userSettings?.notifications?.leadEmails) {
    return; // User has disabled lead notifications
  }

  try {
    await sendLeadNotificationEmail({
      recipientEmail: ownerEmail,
      presentationTitle: presentation.title || 'Untitled',
      presentationId: presentation.id,
      leadName: lead.name,
      leadEmail: lead.email,
      submittedAt: lead.submittedAt,
      repoRoot,
    });
  } catch (err) {
    log.warn('Failed to send lead notification:', err.message);
  }
}

/**
 * Send a lead notification email.
 * Uses admin-customizable email templates with fallback to code defaults.
 * @param {Object} options
 * @param {string} options.recipientEmail - Recipient email
 * @param {string} options.presentationTitle - Presentation title
 * @param {string} options.presentationId - Presentation ID
 * @param {string} options.leadName - Lead's name
 * @param {string} options.leadEmail - Lead's email
 * @param {string} options.submittedAt - Submission timestamp
 * @param {string} options.locale - Locale for translations
 * @param {string} options.repoRoot - Repository root path
 */
async function sendLeadNotificationEmail({
  recipientEmail,
  presentationTitle,
  presentationId,
  leadName,
  leadEmail,
  submittedAt,
  locale = 'en',
  repoRoot = null,
}) {
  const presTitle = presentationTitle || 'Untitled';

  // Get sender identity from settings
  const senderOverride = await getSenderIdentity(repoRoot);

  // Build analytics URL
  const analyticsUrl = presentationId
    ? `${envStr('BASE_URL')}/app/${presentationId}?tab=leads`
    : null;

  // Format the submission date
  const formattedDate = submittedAt
    ? new Date(submittedAt).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Just now';

  // Resolve template (uses admin overrides if available, falls back to i18n)
  const template = await resolveTemplate(repoRoot, 'leadNotification', locale);

  // Prepare variables for interpolation
  const vars = {
    presTitle,
    leadName,
    leadEmail,
    submittedAt: formattedDate,
  };

  // Interpolate placeholders in resolved fields
  const subject = interpolatePlaceholders(template.fields.subject, vars, false);

  const { htmlContent, textContent } = buildLeadNotificationEmail({
    resolvedFields: {
      greeting: interpolatePlaceholders(template.fields.greeting, vars, false),
      body: interpolatePlaceholders(template.fields.body, vars, false),
      buttonLabel: interpolatePlaceholders(template.fields.buttonLabel, vars, false),
      footer: interpolatePlaceholders(template.fields.footer, vars, false),
    },
    presTitle,
    leadName,
    leadEmail,
    submittedAt,
    analyticsUrl,
  });

  return sendEmail({
    to: recipientEmail,
    subject,
    htmlContent,
    textContent,
    senderOverride,
  });
}

/**
 * Send the GDPR self-service verification email to the address that requested
 * access. The token is embedded in the link; the caller (leads route) inspects
 * the returned `reason` — `not_configured` becomes a 501, `upstream` a 502 —
 * so the endpoint is honest instead of claiming a link was sent.
 * @param {Object} options
 * @param {string} options.email - The address that requested its data
 * @param {string} options.token - The verification token
 * @param {string} [options.requestOrigin] - Scheme+host of the incoming request,
 *   used when BASE_URL is unset so the emailed link is always absolute
 * @param {string} [options.locale] - Locale for the email copy
 * @param {string|null} [options.repoRoot] - Repository root for sender resolution
 * @returns {Promise<{ok: boolean, status?: number, error?: string, reason?: 'not_configured'|'upstream'}>}
 */
export async function sendDataRequestVerificationEmail({ email, token, requestOrigin = '', locale = 'en', repoRoot = null }) {
  const tr = createTranslator(locale);
  const senderOverride = await getSenderIdentity(repoRoot);

  const base = envStr('BASE_URL') || requestOrigin;
  // Land on the friendly HTML page (client/my-data.html), which renders the data
  // and offers erase; the page calls GET/DELETE /api/leads/my-data itself with
  // these params. Linking straight at the JSON API would drop a logged-out
  // subject on a raw blob with no way to click "erase".
  const verifyUrl = `${base}/my-data?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

  const subject = tr('email.dataRequest.subject', 'Your data request');
  const { htmlContent, textContent } = buildDataRequestEmail({ tr, verifyUrl });

  return sendEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    senderOverride,
  });
}
