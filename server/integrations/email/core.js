/** Provider-independent transactional mail seam. */
import { getEmailSender } from '../../storage/settings.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import {
  readMailConfig,
  resolveMailSender,
  validMailAddress,
  validMailHeader,
} from './config.js';
import { sendBrevo } from './transports/brevo.js';
import { sendScaleway } from './transports/scaleway.js';
import { sendMailgun } from './transports/mailgun.js';
import { sendSmtp } from './transports/smtp.js';

const TRANSPORTS = {
  smtp: sendSmtp,
  brevo: sendBrevo,
  scaleway: sendScaleway,
  mailgun: sendMailgun,
};

/** Instance settings take precedence over the environment. */
export async function getSenderIdentity(repoRoot) {
  if (!repoRoot) return resolveMailSender();
  try {
    return await getEmailSender(
      crossOrganizationScope(
        repoRoot,
        'outgoing mail: sender identity is instance-level',
      ),
    );
  } catch {
    return resolveMailSender();
  }
}

/** Full transport and effective-sender capability, with no network probe. */
export function isEmailConfigured(senderOverride) {
  return readMailConfig(process.env, senderOverride).configured;
}

/** Send one normalized message; no retries or provider fallback. */
export async function sendEmail({
  to,
  toName,
  subject,
  htmlContent,
  textContent,
  senderOverride,
}) {
  const config = readMailConfig(process.env, senderOverride);
  if (!config.configured)
    return {
      ok: false,
      reason: 'not_configured',
      error: `Outgoing mail not configured: ${config.errors.join(', ') || 'MAIL_TRANSPORT'}`,
    };
  if (
    !validMailAddress(to) ||
    !validMailHeader(toName ?? '') ||
    !validMailHeader(subject) ||
    typeof htmlContent !== 'string' ||
    (textContent !== undefined && typeof textContent !== 'string')
  ) {
    return { ok: false, reason: 'upstream', error: 'Invalid mail message' };
  }
  return TRANSPORTS[config.transport](config.options, {
    from: config.from,
    to: { email: to, ...(toName ? { name: toName } : {}) },
    subject,
    html: htmlContent,
    ...(textContent !== undefined ? { text: textContent } : {}),
  });
}
