/**
 * Core email sending functionality via Brevo API.
 */

import { getEmailSender } from '../../storage/settings.js';
import { getAppName } from '../../config/branding.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import { envStr } from '../../config/utils.js';

export const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

// Default fallbacks for sender identity. The name follows the configured
// app name (APP_NAME) so white-label deployments send under their own brand.
const DEFAULT_SENDER_EMAIL = 'noreply@example.com';

/**
 * Get sender identity from settings or env vars.
 * @param {string|null} repoRoot - Repository root for settings lookup
 * @returns {Promise<{ email: string, name: string }>}
 */
export async function getSenderIdentity(repoRoot) {
  if (!repoRoot) {
    return {
      email: envStr('BREVO_SENDER_EMAIL', DEFAULT_SENDER_EMAIL),
      name: envStr('BREVO_SENDER_NAME') || getAppName(),
    };
  }
  try {
    return await getEmailSender(
      crossOrganizationScope(repoRoot ?? null, 'outgoing mail: sender identity is instance-level')
    );
  } catch {
    return {
      email: envStr('BREVO_SENDER_EMAIL', DEFAULT_SENDER_EMAIL),
      name: envStr('BREVO_SENDER_NAME') || getAppName(),
    };
  }
}

/**
 * Send a transactional email via Brevo.
 * @param {object} options
 * @param {string} options.to - Recipient email address
 * @param {string} [options.toName] - Recipient name (optional)
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlContent - HTML body
 * @param {string} [options.textContent] - Plain text body (optional fallback)
 * @param {object} [options.senderOverride] - Override sender identity from app settings
 * @param {string} [options.senderOverride.email] - Sender email
 * @param {string} [options.senderOverride.name] - Sender name
 * @returns {Promise<{ok: boolean, status?: number, error?: string, reason?: 'not_configured'|'upstream'}>}
 *   On failure, `reason` types it: `not_configured` means this install has no
 *   Brevo key (an operator problem, nothing was attempted), `upstream` means
 *   the provider was tried and failed (HTTP error, network, timeout). Callers
 *   that surface the failure over HTTP map the two differently (501 vs 502).
 */
export async function sendEmail({ to, toName, subject, htmlContent, textContent, senderOverride }) {
  const apiKey = envStr('BREVO_API_KEY');
  if (!apiKey) {
    return { ok: false, reason: 'not_configured', error: 'BREVO_API_KEY not configured' };
  }

  // Priority: senderOverride (from app settings) > env vars > defaults
  const senderEmail =
    senderOverride?.email ||
    envStr('BREVO_SENDER_EMAIL') ||
    DEFAULT_SENDER_EMAIL;
  const senderName =
    senderOverride?.name ||
    envStr('BREVO_SENDER_NAME') ||
    getAppName();

  const payload = {
    sender: {
      email: senderEmail,
      name: senderName,
    },
    to: [
      {
        email: to,
        ...(toName ? { name: toName } : {}),
      },
    ],
    subject,
    htmlContent,
    ...(textContent ? { textContent } : {}),
  };

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 10000);

  try {
    const resp = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { ok: false, reason: 'upstream', status: resp.status, error: text || `HTTP ${resp.status}` };
    }

    return { ok: true, status: resp.status };
  } catch (e) {
    return { ok: false, reason: 'upstream', error: String(e?.message || e) };
  } finally {
    clearTimeout(timeout);
  }
}
