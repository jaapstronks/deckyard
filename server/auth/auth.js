import crypto from 'node:crypto';
import { parseCookies } from '../utils/cookies.js';
import { verifyPassword as verifyDbPassword } from '../storage/password-reset.js';
import {
  getUserByEmailGlobal,
  resolveActiveMembership,
} from '../storage/identity.js';
import { shouldUseSecureCookies } from '../utils/request-url.js';
import { sessionVersion } from '../utils/session-version.js';
import { isMultiOrgEnabled } from '../config/features.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { envBool, envStr } from '../config/utils.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth');

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
  const email = envStr('AUTH_ADMIN_EMAIL').toLowerCase();
  if (!email && !warnedNoAdminEmail) {
    warnedNoAdminEmail = true;
    log.warn('AUTH_ADMIN_EMAIL not configured - no admin user set');
  }
  return email;
}

function getSecret() {
  const s = envStr('AUTH_SECRET');
  if (!s)
    throw new Error(
      'AUTH_SECRET is required when auth is enabled'
    );
  return s;
}

let warnedCookieDomain = false;

function getCookieDomain() {
  const d = envStr('COOKIE_DOMAIN');
  if (!d) return null;

  // Validate cookie domain format
  // Should start with a dot for subdomain sharing (e.g., .example.com)
  // or be a specific hostname
  if (!warnedCookieDomain) {
    if (d.includes(' ') || d.includes(';') || d.includes(',')) {
      log.error('COOKIE_DOMAIN contains invalid characters - ignoring');
      return null;
    }
    if (!d.startsWith('.') && d.includes('.')) {
      // Not starting with dot but has dots - might be intentional for single domain
      // This is valid, just log for awareness
      log.info(`COOKIE_DOMAIN "${d}" set for single domain (not subdomain sharing)`);
    }
    warnedCookieDomain = true;
  }

  return d;
}

let warnedAuthMisconfig = false;

export function authEnabled() {
  const hasSecret = !!envStr('AUTH_SECRET');
  // Default-ON: only a recognized falsy token (false/0/no/off) disables auth.
  // envBool's fallback-on-unrecognized is load-bearing here — a typo'd value
  // must leave auth on, never fail open to anonymous admin.
  const enabled = envBool('AUTH_ENABLED', true);

  if (enabled && !hasSecret && !warnedAuthMisconfig) {
    warnedAuthMisconfig = true;
    log.warn(
      'AUTH_ENABLED but AUTH_SECRET is missing; auth disabled until configured.'
    );
  }
  return enabled && hasSecret;
}

// Minimum AUTH_SECRET length enforced at boot. Session tokens are
// HMAC-SHA256-signed with this secret; below this floor it is brute-forceable
// and forgeable. 32 chars of randomness is the value recommended in
// .env.example.
export const MIN_AUTH_SECRET_LENGTH = 32;

/**
 * Guard against auth misconfiguration at startup. Two fatal cases:
 *
 * 1. **Fail-open**: authEnabled() returns false when AUTH_SECRET is missing,
 *    which makes getUserFromRequest[/Async] fall back to a hardcoded anonymous
 *    ADMIN user. That silent open-admin is only acceptable when the operator
 *    explicitly opted out (AUTH_ENABLED=false) or is in a sandbox/demo instance.
 * 2. **Weak secret**: a secret shorter than MIN_AUTH_SECRET_LENGTH makes the
 *    session-signing HMAC brute-forceable, so tokens can be forged. Boot is
 *    refused below the floor unless the operator sets AUTH_ALLOW_WEAK_SECRET
 *    (an explicit, documented escape hatch) or is in sandbox/demo mode.
 *
 * Both are behaviour that must stop startup rather than expose an insecure
 * instance.
 *
 * @returns {string|null} an error message when misconfigured, else null.
 * @see docs/reference/security-posture.md § Auth misconfiguration is fatal at startup
 * @see security-audit-2026-07 L3 (weak-secret boot floor)
 */
export function authConfigError() {
  const secret = envStr('AUTH_SECRET');

  if (!envBool('AUTH_ENABLED', true)) return null;

  const isSandboxOrDemo = envBool('SANDBOX_MODE') || envBool('DEMO_MODE');

  if (!secret) {
    if (isSandboxOrDemo) return null;
    return (
      'AUTH_SECRET is missing while authentication is not explicitly disabled. ' +
      'Deckyard refuses to start with anonymous admin access. Set AUTH_SECRET to ' +
      'enable auth, or set AUTH_ENABLED=false to run intentionally without auth.'
    );
  }

  if (
    secret.length < MIN_AUTH_SECRET_LENGTH &&
    !isSandboxOrDemo &&
    !envBool('AUTH_ALLOW_WEAK_SECRET')
  ) {
    return (
      `AUTH_SECRET is only ${secret.length} characters; Deckyard refuses to ` +
      `start with a secret shorter than ${MIN_AUTH_SECRET_LENGTH} characters ` +
      'because session tokens are HMAC-signed with it and a short secret is ' +
      `brute-forceable. Use at least ${MIN_AUTH_SECRET_LENGTH} random characters, ` +
      'or set AUTH_ALLOW_WEAK_SECRET=true to override (not recommended).'
    );
  }

  return null;
}

/**
 * Non-fatal auth configuration warnings surfaced at startup. Unlike
 * authConfigError() (which blocks boot on a fail-open misconfiguration or a
 * sub-floor secret), these flag settings that work but are weak enough to
 * warrant tightening. Returns [] when there is nothing to warn about.
 *
 * The short-secret warning still fires here for the cases that reach boot with
 * a sub-floor secret: an explicit AUTH_ALLOW_WEAK_SECRET override, or
 * sandbox/demo mode.
 *
 * @returns {string[]}
 */
export function authConfigWarnings() {
  const warnings = [];
  const secret = envStr('AUTH_SECRET');
  // A short secret weakens the HMAC that signs session tokens. This only
  // reaches boot when the hard floor was overridden or in sandbox/demo.
  if (secret && envBool('AUTH_ENABLED', true) && secret.length < MIN_AUTH_SECRET_LENGTH) {
    warnings.push(
      `AUTH_SECRET is only ${secret.length} characters; use at least ` +
        `${MIN_AUTH_SECRET_LENGTH} random characters so session tokens cannot ` +
        'be brute-forced.'
    );
  }
  return warnings;
}

export function devAuthBypassEnabled() {
  // Passwordless admin bypass is a development convenience ONLY. Refuse it
  // unless NODE_ENV is explicitly 'development', so a leftover
  // AUTH_DEV_BYPASS=1 in a staging/prod/unset-NODE_ENV .env can't silently
  // grant anonymous admin. Belt-and-suspenders with the startup check in
  // server.js. See docs/reference/security-posture.md
  // § Dev auth bypass is development-only.
  if (envStr('NODE_ENV').toLowerCase() !== 'development') {
    return false;
  }
  return envBool('AUTH_DEV_BYPASS');
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

/**
 * Synchronous best-effort user resolution from a signed session cookie.
 *
 * SECURITY: this validates the token signature and expiry but does NOT confirm
 * the user still exists or that the session version matches the current
 * password (it returns `_needsDbValidation: true` for db users instead of
 * doing the async DB check). A validly-signed, unexpired token therefore
 * resolves here even for a deleted/disabled user until the 14-day expiry.
 *
 * For that reason it MUST NOT be used to make an authorization decision — use
 * the async {@link getUserFromRequestAsync} for anything gated on identity.
 * As of the 2026-07 security audit (L3) this function has no callers that take
 * an authz decision; it is retained as a public helper for display-only /
 * best-effort contexts. If you add a caller, use the async path unless you can
 * prove the value is never used for authorization.
 *
 * @param {Object} req - HTTP request
 * @returns {Object|null}
 */
export function getUserFromRequest(req) {
  if (!authEnabled())
    return {
      email: 'anonymous',
      role: 'admin',
      isAdmin: true,
      // Auth is off: this is the single trusted local operator, so authorization
      // checks grant full access regardless of per-deck ownership. See
      // isUnrestricted() in presentation-authz/presentations.js.
      unrestricted: true,
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
      // Include organization context from session (multi-organization mode).
      // No default fallback: this synchronous path is marked
      // `_needsDbValidation` and is ignored by createStorageScope, so a missing
      // orgId must stay missing rather than resolve to the default organization.
      organizationId: payload?.orgId,
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
 * @param {Object} [ctx] - Unused. Identity resolution is organization-
 *   independent; the parameter is kept because all 22 call sites pass it and
 *   removing it would be a churn-only change.
 * @returns {Promise<Object|null>} - User object or null
 */
export async function getUserFromRequestAsync(req, ctx) {
  if (!authEnabled())
    return {
      email: 'anonymous',
      role: 'admin',
      isAdmin: true,
      // Auth is off: this is the single trusted local operator, so authorization
      // checks grant full access regardless of per-deck ownership. See
      // isUnrestricted() in presentation-authz/presentations.js.
      unrestricted: true,
      organizationId: getDefaultOrganizationId(),
    };
  if (devAuthBypassEnabled()) {
    const user = devBypassUser();
    return {
      ...user,
      // The bypass pins the organization on the default one and ignores the
      // session cookie, so there is no membership to read a role from. Every
      // organization-dependent flow therefore needs a real login to verify.
      organizationId: getDefaultOrganizationId(),
      organizationRole: null,
    };
  }

  const payload = parseSessionToken(req);
  if (!payload) return null;

  const email = String(payload?.email || '').toLowerCase();

  // Check database users - support all auth sources. Identity is resolved
  // across organizations: which organization the session is in is a separate
  // question, answered by resolveActiveMembership() below.
  const dbUser = await getUserByEmailGlobal(email);
  if (!dbUser) return null;

  // Recompute the version claim the cookie must carry. Shared with every
  // minter, so a mismatch means the row changed after the cookie was signed.
  const expectedV = sessionVersion(dbUser);

  if (String(payload?.v || '') === expectedV) {
    // Which organization this session may act in. Single-organization mode answers
    // this from configuration without touching the database; multi-organization
    // mode re-verifies membership, because the token outlives a revocation.
    const {
      organizationId,
      role: organizationRole,
      isDesigner: organizationIsDesigner,
    } = await resolveActiveMembership(dbUser.id, payload?.orgId);
    if (!organizationId) return null;

    const adminEmail = getAdminEmail();
    const role =
      dbUser.role === 'admin' || email === adminEmail
        ? 'admin'
        : 'user';
    return {
      // The stable `users.id`. This is the key every ownership decision keys on
      // (shared/identity-match.js); the email beside it is a
      // display/contact value and a fallback identifier for the shapes that have
      // no id — file mode, external/legacy rows, the auth-off operator. Only
      // this async path can carry it: the synchronous getUserFromRequest reads a
      // cookie without touching the database, and takes no authz decision.
      id: dbUser.id,
      email,
      role,
      name: dbUser.name || '',
      isAdmin: role === 'admin',
      authSource: dbUser.auth_source || 'database',
      organizationId,
      // The role held in *this* organization (owner/admin/member), as opposed
      // to the instance-wide `isAdmin` above. Null in single-organization mode,
      // where there is only one organization and no membership to read. The
      // UI gates admin surfaces on both; see client/lib/user/organization-role.js.
      organizationRole,
      // The raw `is_designer` flag on that same membership row. Carried so
      // designer-capability resolution can reuse the row already read here
      // instead of re-querying it (see utils/designer.js). Null whenever
      // `organizationRole` is — single-organization has no membership row to read.
      organizationIsDesigner,
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

  // Include organization ID in session when multi-organization is enabled
  // This allows organization context to persist across requests
  if (isMultiOrgEnabled()) {
    // No default fallback under multi-organization: stamping the default
    // organization into the cookie would let a session act in an organization it
    // was never resolved to. A missing org stays missing.
    payload.orgId = organizationId || user.organizationId;
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
 * Used when switching organizations in multi-organization mode.
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @param {string} organizationId - New organization ID
 */
export function updateSessionOrganization(req, res, organizationId) {
  if (!isMultiOrgEnabled()) return;

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
 * @param {Object} [ctx] - Unused; see getUserFromRequestAsync.
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

  // Check database user. Logging in is an identity question, so the lookup is
  // not scoped to an organization; the organization is picked afterwards.
  const dbUser = await getUserByEmailGlobal(email);
  if (dbUser?.password_hash && dbUser?.auth_source === 'database') {
    const valid = await verifyDbPassword(password, dbUser.password_hash);
    if (valid) {
      const adminEmail = getAdminEmail();
      const role =
        dbUser.role === 'admin' || email === adminEmail
          ? 'admin'
          : 'user';
      // Version key for session invalidation, derived exactly as
      // getUserFromRequestAsync will recompute it on the next request.
      const v = sessionVersion(dbUser);
      return {
        // The stable `users.id`, carried from the moment of login so the client
        // can compare identities on the key rather than on an address — see
        // shared/identity-match.js.
        id: dbUser.id,
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