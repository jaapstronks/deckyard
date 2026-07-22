/**
 * Global security headers.
 *
 * There is no framework or middleware stack here, so these are applied via
 * res.setHeader() at the very top of the request handler. Node merges
 * setHeader() values into the later res.writeHead(status, {...}) call (with any
 * keys the handler passes taking precedence), so individual route handlers need
 * no changes and no existing header is clobbered.
 *
 * Covers the app, presenter, login and reader surfaces that previously had zero
 * framing/clickjacking protection (security-audit H8). X-Frame-Options is
 * omitted for intentionally embeddable paths (/embed/*) so Notion/iframe embeds
 * keep working; everything else denies framing.
 */

import { shouldUseSecureCookies } from './request-url.js';

/**
 * Whether a path is intentionally embeddable in third-party iframes.
 * @param {string} pathname - Request pathname
 * @returns {boolean}
 */
function isFrameable(pathname) {
  return typeof pathname === 'string' && pathname.startsWith('/embed/');
}

/**
 * Apply baseline security headers to a response.
 * @param {import('node:http').IncomingMessage} req - Request (for HTTPS detection)
 * @param {import('node:http').ServerResponse} res - Response to decorate
 * @param {string} pathname - Request pathname (decides framing)
 */
export function applySecurityHeaders(req, res, pathname) {
  // Never let a response be sniffed into a different Content-Type.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Don't leak full URLs (tokens in query strings) on cross-origin navigation.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Clickjacking protection for every surface except the embed iframe.
  if (!isFrameable(pathname)) {
    res.setHeader('X-Frame-Options', 'DENY');
  }

  // HSTS only when the connection is actually HTTPS (or secure cookies are
  // forced) — never send it over plain HTTP, where it can lock users out.
  if (shouldUseSecureCookies(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}
