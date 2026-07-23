/**
 * Single sign-on (SSO) configuration for Track 1: self-hosted, single-IdP,
 * OIDC-first. One identity provider per install, configured entirely via
 * environment variables (mirrors how first-party auth is configured).
 *
 * This module is the single source of truth for reading and validating that
 * config. It intentionally does NOT touch the OIDC protocol — that lives in
 * `server/auth/providers/oidc.js`. Keeping the two apart means the login page
 * and boot-time validation can ask "is SSO configured?" without pulling in the
 * `openid-client` dependency or doing any network I/O.
 *
 * @see docs/plans/briefs/sso-integration.md (Track 1)
 * @see docs/reference/sso-oidc.md
 */

import { truthy } from './utils.js';

/** Only provider supported in Track 1. SAML (1b) is added on demand. */
const SUPPORTED_PROVIDERS = ['oidc'];

/** Role assigned to JIT-provisioned users unless a group maps them to admin. */
const DEFAULT_PROVISION_ROLE = 'user';

function str(name) {
  return String(process.env[name] || '').trim();
}

/**
 * Parse a comma/space-separated env var into a lowercased, de-duplicated list.
 * @param {string} name - Environment variable name.
 * @returns {string[]}
 */
function list(name) {
  return [
    ...new Set(
      str(name)
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/**
 * The provider selected for this install, or null when SSO is off / unset.
 * @returns {string|null}
 */
export function getSsoProvider() {
  const p = str('SSO_PROVIDER').toLowerCase();
  return SUPPORTED_PROVIDERS.includes(p) ? p : null;
}

/**
 * Whether SSO is turned on AND minimally configured. Callers can rely on this
 * being false whenever a login attempt would fail for lack of config.
 * @returns {boolean}
 */
export function isSsoEnabled() {
  if (!truthy(process.env.SSO_ENABLED)) return false;
  const provider = getSsoProvider();
  if (provider !== 'oidc') return false;
  return !ssoConfigError();
}

/**
 * Whether password / magic-link login should be hidden. Only meaningful when
 * {@link isSsoEnabled} is true; enforcement without a working IdP would lock
 * everyone out, so we require SSO to be enabled first.
 * @returns {boolean}
 */
export function isSsoEnforced() {
  return isSsoEnabled() && truthy(process.env.SSO_ENFORCE);
}

/**
 * Resolve the full OIDC configuration from the environment.
 * @returns {{
 *   issuerUrl: string,
 *   clientId: string,
 *   clientSecret: string,
 *   redirectUri: string,
 *   allowedDomains: string[],
 *   autoProvision: boolean,
 *   defaultRole: string,
 *   adminGroups: string[],
 * }}
 */
export function getOidcConfig() {
  const defaultRole =
    str('OIDC_DEFAULT_ROLE').toLowerCase() === 'admin'
      ? 'admin'
      : DEFAULT_PROVISION_ROLE;
  return {
    issuerUrl: str('OIDC_ISSUER_URL'),
    clientId: str('OIDC_CLIENT_ID'),
    clientSecret: str('OIDC_CLIENT_SECRET'),
    redirectUri: str('OIDC_REDIRECT_URI'),
    allowedDomains: list('OIDC_ALLOWED_DOMAINS'),
    // JIT-provision on first login unless explicitly disabled.
    autoProvision:
      process.env.OIDC_AUTO_PROVISION === undefined
        ? true
        : truthy(process.env.OIDC_AUTO_PROVISION),
    defaultRole,
    adminGroups: list('OIDC_ADMIN_GROUPS'),
  };
}

/**
 * Validate the SSO config at boot. Returns a human-readable error string when
 * SSO is switched on but unusable, else null. Mirrors {@link authConfigError}:
 * a half-configured SSO must fail loudly rather than silently disable itself,
 * because an operator who set SSO_ENABLED=true expects SSO to work.
 *
 * Returns null when SSO_ENABLED is falsy (nothing to validate).
 *
 * @returns {string|null}
 */
export function ssoConfigError() {
  if (!truthy(process.env.SSO_ENABLED)) return null;

  const provider = str('SSO_PROVIDER').toLowerCase();
  if (!provider) {
    return 'SSO_ENABLED is set but SSO_PROVIDER is missing. Set SSO_PROVIDER=oidc.';
  }
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return `SSO_PROVIDER="${provider}" is not supported. Only "oidc" is available (SAML is on the roadmap).`;
  }

  const missing = [];
  if (!str('OIDC_ISSUER_URL')) missing.push('OIDC_ISSUER_URL');
  if (!str('OIDC_CLIENT_ID')) missing.push('OIDC_CLIENT_ID');
  if (!str('OIDC_CLIENT_SECRET')) missing.push('OIDC_CLIENT_SECRET');
  if (!str('OIDC_REDIRECT_URI')) missing.push('OIDC_REDIRECT_URI');
  if (missing.length) {
    return `SSO_ENABLED=true with SSO_PROVIDER=oidc but required OIDC settings are missing: ${missing.join(', ')}.`;
  }

  // Fail early on malformed URLs rather than at first login.
  for (const [name, value] of [
    ['OIDC_ISSUER_URL', str('OIDC_ISSUER_URL')],
    ['OIDC_REDIRECT_URI', str('OIDC_REDIRECT_URI')],
  ]) {
    try {
      // eslint-disable-next-line no-new
      new URL(value);
    } catch {
      return `${name}="${value}" is not a valid absolute URL.`;
    }
  }

  return null;
}

/**
 * Public, non-secret view of the SSO config for the login page. Safe to expose
 * to unauthenticated clients: only booleans, the provider name, and the login
 * entry-point URL — never the client secret.
 * @returns {{ enabled: boolean, enforce: boolean, provider: string|null, loginPath: string }}
 */
export function getSsoPublicConfig() {
  const enabled = isSsoEnabled();
  return {
    enabled,
    enforce: enabled && truthy(process.env.SSO_ENFORCE),
    provider: enabled ? getSsoProvider() : null,
    loginPath: '/api/auth/oidc/login',
  };
}
