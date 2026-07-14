/**
 * Core email sending functionality via Brevo API.
 */

import { getEmailSender } from '../../storage/settings.js';

export const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

// Default fallbacks for sender identity
const DEFAULT_SENDER_EMAIL = 'noreply@example.com';
const DEFAULT_SENDER_NAME = 'Presentation System';

/**
 * Get sender identity from settings or env vars.
 * @param {string|null} repoRoot - Repository root for settings lookup
 * @returns {Promise<{ email: string, name: string }>}
 */
export async function getSenderIdentity(repoRoot) {
  if (!repoRoot) {
    return {
      email: process.env.BREVO_SENDER_EMAIL || DEFAULT_SENDER_EMAIL,
      name: process.env.BREVO_SENDER_NAME || DEFAULT_SENDER_NAME,
    };
  }
  try {
    return await getEmailSender(repoRoot);
  } catch {
    return {
      email: process.env.BREVO_SENDER_EMAIL || DEFAULT_SENDER_EMAIL,
      name: process.env.BREVO_SENDER_NAME || DEFAULT_SENDER_NAME,
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
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
export async function sendEmail({ to, toName, subject, htmlContent, textContent, senderOverride }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'BREVO_API_KEY not configured' };
  }

  // Priority: senderOverride (from app settings) > env vars > defaults
  const senderEmail =
    senderOverride?.email ||
    process.env.BREVO_SENDER_EMAIL ||
    DEFAULT_SENDER_EMAIL;
  const senderName =
    senderOverride?.name ||
    process.env.BREVO_SENDER_NAME ||
    DEFAULT_SENDER_NAME;

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
      return { ok: false, status: resp.status, error: text || `HTTP ${resp.status}` };
    }

    return { ok: true, status: resp.status };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timeout);
  }
}
