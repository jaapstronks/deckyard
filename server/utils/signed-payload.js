/**
 * A small expiring payload signed with HMAC-SHA256: `<base64url JSON>.<sig>`.
 *
 * For state the server hands out and must recognise later without storing it:
 * the OIDC flow's state cookie (`routes/api/sso.js`) and the share-link render
 * grant (`routes/api/share-links/public.js`). The payload is readable by whoever
 * holds it; the signature only proves the server minted it and nothing changed.
 *
 * Every payload carries `exp` (epoch ms). {@link readSignedPayload} refuses one
 * without it, so a signed value cannot be minted that never expires.
 */

import crypto from 'node:crypto';

/**
 * @param {string} secret
 * @param {string} body - The base64url payload.
 * @returns {string} base64url HMAC-SHA256 of `body`.
 */
function signature(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * Sign `payload` with `secret`.
 *
 * @param {{ exp: number } & Object} payload - Must carry `exp` (epoch ms).
 * @param {string} secret
 * @returns {string}
 */
export function signPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signature(secret, body)}`;
}

/**
 * Verify and decode a value from {@link signPayload}.
 *
 * @param {unknown} token
 * @param {string} secret
 * @returns {Object|null} The payload, or null when the signature is bad, the
 *   value is malformed, or `exp` is missing or past.
 */
export function readSignedPayload(token, secret) {
  if (typeof token !== 'string' || !secret) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(signature(secret, body)),
      )
    )
      return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.exp || Number(payload.exp) < Date.now()) return null;
  return payload;
}
