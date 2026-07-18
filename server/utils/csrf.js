/**
 * CSRF defense for cookie-authenticated, state-changing requests.
 *
 * The session cookie is HttpOnly; SameSite=Lax, which already blocks the cookie
 * from riding most cross-site requests. This adds an Origin/Referer check as
 * defense-in-depth for the residual gaps (Lax still allows top-level GET
 * navigations, and is per-site not per-origin, so a sibling subdomain could
 * otherwise forge requests).
 *
 * Scope: enforced ONLY when the session cookie is present. Requests
 * authenticated some other way (API key on /api/v1, MCP bearer) or not at all
 * (public audience endpoints) cannot be abused via a victim's browser cookie,
 * so they are exempt — no client changes required.
 *
 * See docs/plans/security-hardening.md item 5c.
 */

import { parseCookies } from './cookies.js';

const SESSION_COOKIE = 'sb_session';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Extract a lowercased host from a URL/origin string, or null. */
function hostOf(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The set of hosts a state-changing request may legitimately originate from:
 * the request's own Host, plus configured APP_URL/DOMAIN (covers reverse-proxy
 * setups where the internal Host differs from the public one) and an optional
 * explicit CSRF_ALLOWED_ORIGINS allowlist.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Set<string>}
 */
export function allowedHosts(req) {
  const set = new Set();
  const reqHost = String(req.headers?.host || '').trim().toLowerCase();
  if (reqHost) set.add(reqHost);
  for (const v of [process.env.APP_URL, process.env.DOMAIN]) {
    const h = hostOf(v);
    if (h) set.add(h);
  }
  for (const o of String(process.env.CSRF_ALLOWED_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    const h = hostOf(o);
    if (h) set.add(h);
  }
  return set;
}

/**
 * Decide whether a request is safe from CSRF.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean} true if allowed, false if it should be rejected (403)
 */
export function isCsrfSafe(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!MUTATING_METHODS.has(method)) return true;

  // Only cookie-authenticated requests are CSRF-able.
  const cookies = parseCookies(req.headers?.cookie);
  if (!cookies[SESSION_COOKIE]) return true;

  const origin = req.headers?.origin;
  const referer = req.headers?.referer || req.headers?.referrer;
  const sourceHost = origin ? hostOf(origin) : referer ? hostOf(referer) : null;

  // No Origin/Referer: modern browsers send Origin on state-changing fetches
  // (same- and cross-origin), so a missing value indicates a non-browser
  // client. With SameSite=Lax the session cookie won't ride a cross-site
  // request anyway, so allow rather than break native/CLI clients.
  if (!sourceHost) return true;

  return allowedHosts(req).has(sourceHost);
}
