/**
 * Lead capture email senders.
 */

import { buildLeadNotificationEmail } from '../email-templates.js';
import { sendEmail, getSenderIdentity } from './core.js';
import { readUserSettings } from '../../storage/settings.js';
import { resolveTemplate, interpolatePlaceholders } from '../email-template-resolver.js';

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
  const userSettings = await readUserSettings(repoRoot, ownerEmail);
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
    // eslint-disable-next-line no-console
    console.warn('[email] Failed to send lead notification:', err.message);
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
    ? `${process.env.BASE_URL || ''}/app/${presentationId}?tab=leads`
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
