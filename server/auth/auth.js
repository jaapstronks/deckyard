import crypto from 'node:crypto';
import { parseCookies } from '../utils/cookies.js';
import {
  getDatabaseUser,
  verifyPassword as verifyDbPassword,
} from '../storage/password-reset.js';
import { shouldUseSecureCookies } from '../utils/request-url.js';
import { isMultiWorkspaceEnabled } from '../config/features.js';
import { getDefaultOrganizationId } from '../config/database.js';

const COOKIE_NAME = 'sb_session';

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function base64urlToBuf(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad)
    .replaceAll('-', '+')
    .replaceAll('_', '/');
  return Buffer.from(b64, 'base64');
}

let warnedNoAdminEmail = false;

function getAdminEmail() {
  const email = String(process.env.AUTH_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email && !warnedNoAdminEmail) {
    warnedNoAdminEmail = true;
    console.warn('[auth] AUTH_ADMIN_EMAIL not configured - no admin user set');
  }
  return email;
}

function getSecret() {
  const s = String(process.env.AUTH_SECRET || '').trim();
  if (!s)
    throw new Error(
      'AUTH_SECRET is required when auth is enabled'
    );
  return s;
}

let warnedCookieDomain = false;

function getCookieDomain() {
  const d = String(process.env.COOKIE_DOMAIN || '').trim();
  if (!d) return null;

  // Validate cookie domain format
  // Should start with a dot for subdomain sharing (e.g., .example.com)
  // or be a specific hostname
  if (!warnedCookieDomain) {
    if (d.includes(' ') || d.includes(';') || d.includes(',')) {
      console.error('[auth] COOKIE_DOMAIN contains invalid characters - ignoring');
      return null;
    }
    if (!d.startsWith('.') && d.includes('.')) {
      // Not starting with dot but has dots - might be intentional for single domain
      // This is valid, just log for awareness
      console.info(`[auth] COOKIE_DOMAIN "${d}" set for single domain (not subdomain sharing)`);
    }
    warnedCookieDomain = true;
  }

  return d;
}

let warnedAuthMisconfig = false;

export function authEnabled() {
  const hasSecret = !!String(
    process.env.AUTH_SECRET || ''
  ).trim();
  // Default to enabled - explicitly set AUTH_ENABLED=false to disable
  const explicitlyDisabled =
    String(process.env.AUTH_ENABLED || '').trim().toLowerCase() === 'false';
  const enabled = !explicitlyDisabled;

  if (enabled && !hasSecret && !warnedAuthMisconfig) {
    warnedAuthMisconfig = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[auth] AUTH_ENABLED but AUTH_SECRET is missing; auth disabled until configured.'
    );
  }
  return enabled && hasSecret;
}

export function devAuthBypassEnabled() {
  const v = String(process.env.AUTH_DEV_BYPASS || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function devBypassUser() {
  return {
    email: 'dev@local',
    role: 'admin',
    name: 'Dev',
    isAdmin: true,
    v: 'dev',
  };
}

function sign(secret, payloadB64) {
  return base64url(
    crypto
      .createHmac('sha256', secret)
      .update(payloadB64)
      .digest()
  );
}

/**
 * Parse and validate session token from request.
 * Returns payload if valid, null otherwise.
 * @param {Object} req - HTTP request
 * @returns {{email: string, v: string, role: string, name: string, exp: number}|null}
 */
function parseSessionToken(req) {
  const secret = getSecret();
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const [payloadB64, sig] = String(token).split('.');
  if (!payloadB64 || !sig) return null;
  const expected = sign(secret, payloadB64);
  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(expected)
      )
    )
      return null;
  } catch {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(
      base64urlToBuf(payloadB64).toString('utf8')
    );
  } catch {
    return null;
  }

  const now = Date.now();
  if (!payload?.exp || Number(payload.exp) < now)
    return null;
  const email = String(payload?.email || '').toLowerCase();
  if (!email) return null;

  return payload;
}

export function getUserFromRequest(req) {
  if (!authEnabled())
    return {
      email: 'anonymous',
      role: 'admin',
      isAdmin: true,
      organizationId: getDefaultOrganizationId(),
    };
  if (devAuthBypassEnabled()) {
    const user = devBypassUser();
    return {
      ...user,
      organizationId: getDefaultOrganizationId(),
    };
  }

  const payload = parseSessionToken(req);
  if (!payload) return null;

  const email = String(payload?.email || '').toLowerCase();

  // Return partial info for database users - needs async validation
  if (payload?.v) {
    const adminEmail = getAdminEmail();
    const role = payload?.role === 'admin' || email === adminEmail
      ? 'admin'
      : 'user';
    return {
      email,
      role,
      name: payload?.name || '',
      isAdmin: role === 'admin',
      // Include organization context from session (multi-workspace mode)
      organizationId: payload?.orgId || getDefaultOrganizationId(),
      _needsDbValidation: true,
      _sessionV: payload?.v,
    };
  }

  return null;
}

/**
 * Get user from request with async database validation.
 * Supports all auth sources: database (with/without password), magic_link, etc.
 * @param {Object} req - HTTP request
 * @param {Object} ctx - Context object for database access
 * @returns {Promise<Object|null>} - User object or null
 */
export async function getUserFromRequestAsync(req, ctx) {
  if (!authEnabled())
    return {
      email: 'anonymous',
      role: 'admin',
      isAdmin: true,
      organizationId: getDefaultOrganizationId(),
    };
  if (devAuthBypassEnabled()) {
    const user = devBypassUser();
    return {
      ...user,
      organizationId: getDefaultOrganizationId(),
    };
  }

  const payload = parseSessionToken(req);
  if (!payload) return null;

  const email = String(payload?.email || '').toLowerCase();

  // Check database users - support all auth sources
  const dbUser = await getDatabaseUser(email, ctx);
  if (!dbUser) return null;

  // Calculate expected session version
  // Use password_changed_at if set, otherwise fall back to updated_at
  // This must match the version calculation in magic-link.js and password login
  const versionSource = dbUser.password_changed_at || dbUser.updated_at;
  const expectedV = versionSource
    ? base64url(
        crypto
          .createHash('sha256')
          .update(String(versionSource))
          .digest()
      ).slice(0, 12)
    : 'db';

  if (String(payload?.v || '') === expectedV) {
    const adminEmail = getAdminEmail();
    const role =
      dbUser.role === 'admin' || email === adminEmail
        ? 'admin'
        : 'user';
    return {
      email,
      role,
      name: dbUser.name || '',
      isAdmin: role === 'admin',
      authSource: dbUser.auth_source || 'database',
      // Include organization context from session (multi-workspace mode)
      organizationId: payload?.orgId || getDefaultOrganizationId(),
    };
  }

  return null;
}

export function setSessionCookie(
  req,
  res,
  user,
  { days = 14, organizationId = null } = {}
) {
  const secret = getSecret();
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = {
    email: user.email,
    role: user.role,
    name: user.name || '',
    exp,
    v: user.v,
  };

  // Include organization ID in session when multi-workspace is enabled
  // This allows workspace context to persist across requests
  if (isMultiWorkspaceEnabled()) {
    payload.orgId = organizationId || user.organizationId || getDefaultOrganizationId();
  }

  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = sign(secret, payloadB64);
  const token = `${payloadB64}.${sig}`;

  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor((exp - Date.now()) / 1000)}`,
  ];

  // Add cookie domain for cross-subdomain SSO
  const domain = getCookieDomain();
  if (domain) parts.push(`Domain=${domain}`);

  if (shouldUseSecureCookies(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/**
 * Update the organization context in the user's session cookie.
 * Used when switching workspaces in multi-workspace mode.
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @param {string} organizationId - New organization ID
 */
export function updateSessionOrganization(req, res, organizationId) {
  if (!isMultiWorkspaceEnabled()) return;

  const payload = parseSessionToken(req);
  if (!payload) return;

  // Re-create the session with the new organization
  const user = {
    email: payload.email,
    role: payload.role,
    name: payload.name,
    v: payload.v,
  };

  // Calculate remaining days until expiration
  const remainingMs = payload.exp - Date.now();
  const remainingDays = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));

  setSessionCookie(req, res, user, { days: remainingDays, organizationId });
}

export function clearSessionCookie(req, res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];

  // Include domain when clearing to match the original cookie
  const domain = getCookieDomain();
  if (domain) parts.push(`Domain=${domain}`);

  if (shouldUseSecureCookies(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/**
 * Verify login credentials.
 * @param {string} emailRaw - Email address
 * @param {string} passwordRaw - Password
 * @param {Object} ctx - Context object for database access
 * @returns {Promise<Object|null>} - User object or null if invalid
 */
export async function verifyLoginAsync(emailRaw, passwordRaw, ctx) {
  if (!authEnabled())
    return {
      email: 'anonymous',
      role: 'admin',
      isAdmin: true,
      v: 'anon',
    };
  if (devAuthBypassEnabled()) return devBypassUser();

  const email = String(emailRaw || '')
    .trim()
    .toLowerCase();
  const password = String(passwordRaw || '');

  // Check database user
  const dbUser = await getDatabaseUser(email, ctx);
  if (dbUser?.password_hash && dbUser?.auth_source === 'database') {
    const valid = await verifyDbPassword(password, dbUser.password_hash);
    if (valid) {
      const adminEmail = getAdminEmail();
      const role =
        dbUser.role === 'admin' || email === adminEmail
          ? 'admin'
          : 'user';
      // Generate a version key for session invalidation
      // Use password_changed_at if set, otherwise fall back to updated_at
      // This must match the version calculation in getUserFromRequestAsync
      const versionSource = dbUser.password_changed_at || dbUser.updated_at;
      const v = versionSource
        ? base64url(
            crypto
              .createHash('sha256')
              .update(String(versionSource))
              .digest()
          ).slice(0, 12)
        : 'db';
      return {
        email,
        role,
        name: dbUser.name || '',
        isAdmin: role === 'admin',
        v,
        authSource: 'database',
      };
    }
  }

  return null;
}

// Legacy sync function - returns null, use verifyLoginAsync instead
export function verifyLogin() {
  return null;
}