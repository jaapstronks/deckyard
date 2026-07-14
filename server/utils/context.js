/**
 * Context utilities for request handling.
 * Shared across server modules to avoid code duplication.
 */

import { getDefaultOrganizationId } from '../config/database.js';
import { isMultiWorkspaceEnabled } from '../config/features.js';
import { getClientIp } from './rate-limit.js';

// Re-export getClientIp for backward compatibility with existing imports
export { getClientIp };

// Reserved subdomains that cannot be used as workspace identifiers
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'mail',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
  'media',
  'images',
  'docs',
  'help',
  'support',
  'status',
  'blog',
  'dev',
  'staging',
  'test',
  'demo',
  'sandbox',
]);

/**
 * Get the organization ID from context, falling back to default.
 * @param {Object} ctx - Context object with optional organizationId
 * @returns {string} - Organization ID
 */
export function getOrgId(ctx) {
  return ctx?.organizationId || getDefaultOrganizationId();
}

/**
 * Extract subdomain from hostname.
 * Returns null for reserved subdomains, IP addresses, localhost, or when no subdomain exists.
 * @param {string} hostname - Full hostname (e.g., 'client.deckyard.com')
 * @returns {string|null} - Subdomain or null
 */
export function extractSubdomain(hostname) {
  if (!hostname) return null;

  // Remove port if present
  const host = hostname.split(':')[0].toLowerCase();

  // Skip IP addresses
  if (/^[\d.]+$/.test(host) || host === 'localhost') return null;

  // Split into parts
  const parts = host.split('.');

  // Need at least 3 parts for a subdomain (sub.domain.tld)
  if (parts.length < 3) return null;

  const subdomain = parts[0];

  // Check if subdomain is reserved
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null;

  return subdomain;
}

/**
 * Check if a subdomain is reserved.
 * @param {string} subdomain - Subdomain to check
 * @returns {boolean}
 */
export function isReservedSubdomain(subdomain) {
  return RESERVED_SUBDOMAINS.has(String(subdomain || '').toLowerCase());
}

/**
 * Get organization context from request.
 * In multi-workspace mode, attempts to extract org from subdomain or custom domain.
 * In single-workspace mode, always returns the default organization.
 * @param {Object} req - HTTP request object
 * @returns {Object} - Organization context { organizationId, subdomain, isMultiWorkspace }
 */
export function getOrgContextFromRequest(req) {
  const isMultiWorkspace = isMultiWorkspaceEnabled();

  if (!isMultiWorkspace) {
    return {
      organizationId: getDefaultOrganizationId(),
      subdomain: null,
      isMultiWorkspace: false,
    };
  }

  // In multi-workspace mode, check for subdomain
  const hostname = req?.headers?.host || req?.headers?.['x-forwarded-host'] || '';
  const subdomain = extractSubdomain(hostname);

  // Note: The actual organization lookup happens in the route handler
  // after database access is available. Here we just extract the subdomain.
  return {
    organizationId: null, // Will be resolved by route handler
    subdomain,
    customDomain: hostname, // Full hostname for custom domain lookup
    isMultiWorkspace: true,
  };
}

/**
 * Create a route context object from an authenticated user.
 * @param {Object} authedUser - The authenticated user object
 * @param {Object} [options] - Additional options
 * @param {string} [options.organizationId] - Override organization ID
 * @returns {Object} - Context object with organizationId and actorEmail
 */
export function createRouteContext(authedUser, options = {}) {
  // Allow explicit override of organizationId (for multi-workspace)
  const organizationId = options.organizationId || getDefaultOrganizationId();

  return {
    organizationId,
    actorEmail: authedUser?.email,
  };
}

/**
 * Create a route context with organization resolved from request.
 * This is used by the API index handler to set up context before route handling.
 * @param {Object} authedUser - The authenticated user object
 * @param {Object} resolvedOrg - Resolved organization from subdomain/domain lookup
 * @returns {Object} - Context object with organizationId and actorEmail
 */
export function createMultiWorkspaceContext(authedUser, resolvedOrg) {
  return {
    organizationId: resolvedOrg?.id || getDefaultOrganizationId(),
    organization: resolvedOrg,
    actorEmail: authedUser?.email,
    isMultiWorkspace: isMultiWorkspaceEnabled(),
  };
}

