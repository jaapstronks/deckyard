/**
 * Request URL utilities for extracting and building URLs from HTTP requests.
 * Consolidates duplicated request origin logic across the codebase.
 */

import { getAllowedHosts } from './config.js';

/**
 * Extract the origin URL from a request, handling reverse proxy headers.
 * Validates the host to prevent header injection attacks.
 *
 * @param {Object} req - HTTP request object
 * @returns {string|null} Origin URL (e.g., 'https://example.com') or null if invalid
 */
export function getRequestOrigin(req) {
  const proto =
    (req?.headers?.['x-forwarded-proto'] &&
      String(req.headers['x-forwarded-proto'])
        .split(',')[0]
        .trim()) ||
    (req?.socket?.encrypted ? 'https' : 'http');

  const host =
    (req?.headers?.['x-forwarded-host'] &&
      String(req.headers['x-forwarded-host'])
        .split(',')[0]
        .trim()) ||
    String(req?.headers?.host || '').trim();

  if (!host) return null;

  // Reject hosts with whitespace or newlines (potential header injection)
  if (/[\s\r\n]/.test(host)) return null;

  const protocol = proto === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

/**
 * Check if the request is using HTTPS (either directly or via proxy).
 *
 * @param {Object} req - HTTP request object
 * @returns {boolean} True if the request is using HTTPS
 */
export function isHttpsRequest(req) {
  const xf = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase();
  if (xf === 'https') return true;
  return !!req?.socket?.encrypted;
}

/**
 * Get the host from a request, preferring x-forwarded-host if present.
 *
 * @param {Object} req - HTTP request object
 * @returns {string} Host header value or 'localhost' as fallback
 */
export function getRequestHost(req) {
  const forwarded = req?.headers?.['x-forwarded-host'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return String(req?.headers?.host || 'localhost').trim();
}

/**
 * Validate that the request host is in the allowed hosts list.
 * If no allowed hosts are configured, any host is allowed.
 *
 * @param {Object} req - HTTP request object
 * @returns {boolean} True if the host is allowed
 */
export function isHostAllowed(req) {
  const host = getRequestHost(req);
  const allowedHosts = getAllowedHosts();

  // If no allowed hosts configured, allow any
  if (allowedHosts.length === 0) return true;

  return allowedHosts.includes(host);
}

/**
 * Build an absolute URL from a request and a path.
 * Validates the host if allowed hosts are configured.
 *
 * @param {Object} req - HTTP request object
 * @param {string} path - Path to append (e.g., '/api/users')
 * @param {Object} options - Optional settings
 * @param {boolean} options.validateHost - Whether to validate against allowed hosts (default: true)
 * @returns {string|null} Full URL or null if host validation fails
 */
export function buildRequestUrl(req, path, { validateHost = true } = {}) {
  if (validateHost && !isHostAllowed(req)) {
    return null;
  }

  const origin = getRequestOrigin(req);
  if (!origin) return null;

  const p = String(path || '').trim();
  if (!p) return origin;

  try {
    return new URL(p, origin).href;
  } catch {
    return null;
  }
}

/**
 * Build a share link URL from a request and token.
 * Convenience wrapper around buildRequestUrl.
 *
 * @param {Object} req - HTTP request object
 * @param {string} token - Share link token
 * @returns {string|null} Share URL or null if invalid
 */
export function buildShareUrl(req, token) {
  if (!token) return null;
  return buildRequestUrl(req, `/s/${encodeURIComponent(token)}`);
}

/**
 * Convert a relative path to an absolute URL given an origin.
 * Useful when origin is already computed and you need multiple URLs.
 *
 * @param {string} origin - Origin URL (e.g., 'https://example.com')
 * @param {string} path - Path to append
 * @returns {string|null} Full URL or null if invalid
 */
export function toAbsoluteUrl(origin, path) {
  const p = String(path || '').trim();
  if (!p) return null;
  if (!origin) return null;

  try {
    return new URL(p, origin).href;
  } catch {
    return null;
  }
}

/**
 * Determine if cookies should be set with the Secure flag.
 * Checks both the request protocol and the SECURE_COOKIES env var.
 *
 * @param {Object} req - HTTP request object
 * @returns {boolean} True if cookies should be secure
 */
export function shouldUseSecureCookies(req) {
  if (isHttpsRequest(req)) return true;

  const force = String(process.env.SECURE_COOKIES || '').trim();
  if (force === '1' || force.toLowerCase() === 'true') return true;

  return false;
}