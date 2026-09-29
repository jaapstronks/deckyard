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
 * @see docs/reference/sso-oidc.md
 */

import { envBool, envStr, envList, getAppBaseUrl } from './utils.js';

/** Only provider supported in Track 1. SAML (1b) is added on demand. */
const SUPPORTED_PROVIDERS = ['oidc'];

/** Where the browser starts an OIDC login. */
export const OIDC_LOGIN_PATH = '/api/auth/oidc/login';

/**
 * The path the IdP redirects back to. `OIDC_REDIRECT_URI` must end in exactly
 * this; the route table serves it from this constant too.
 */
export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';

/**
 * The claims read for group/role values when `OIDC_GROUPS_CLAIM` is unset:
 * the two names most IdPs use at the top level of the ID token.
 */
const DEFAULT_GROUPS_CLAIMS = ['groups', 'roles'];

/**
 * The scopes every login requests: `openid` is the protocol, `email` the ACL
 * key, `profile` gives the display name. `OIDC_EXTRA_SCOPES` adds to these
 * and never replaces them (D277), so a login cannot lose its email claim.
 */
export const OIDC_BASE_SCOPES = Object.freeze(['openid', 'email', 'profile']);

/** An RFC 6749 §3.3 scope-token: printable ASCII except space, double quote and backslash. */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

/** Role assigned to JIT-provisioned users unless a group maps them to admin. */
const DEFAULT_PROVISION_ROLE = 'user';

/**
 * The provider selected for this install, or null when SSO is off / unset.
 * @returns {string|null}
 */
export function getSsoProvider() {
  const p = envStr('SSO_PROVIDER').toLowerCase();
  return SUPPORTED_PROVIDERS.includes(p) ? p : null;
}

/**
 * Whether SSO is turned on AND minimally configured. Callers can rely on this
 * being false whenever a login attempt would fail for lack of config.
 * @returns {boolean}
 */
export function isSsoEnabled() {
  if (!envBool('SSO_ENABLED')) return false;
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
  return isSsoEnabled() && envBool('SSO_ENFORCE');
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
 *   groupsClaims: string[],
 *   orgClaim: string,
 *   scopes: string[],
 * }}
 */
export function getOidcConfig() {
  const defaultRole =
    envStr('OIDC_DEFAULT_ROLE').toLowerCase() === 'admin'
      ? 'admin'
      : DEFAULT_PROVISION_ROLE;
  return {
    issuerUrl: envStr('OIDC_ISSUER_URL'),
    clientId: envStr('OIDC_CLIENT_ID'),
    clientSecret: envStr('OIDC_CLIENT_SECRET'),
    redirectUri: envStr('OIDC_REDIRECT_URI'),
    allowedDomains: envList('OIDC_ALLOWED_DOMAINS'),
    // JIT-provision on first login unless explicitly disabled.
    autoProvision: envBool('OIDC_AUTO_PROVISION', true),
    defaultRole,
    adminGroups: envList('OIDC_ADMIN_GROUPS'),
    groupsClaims: parseGroupsClaims(envStr('OIDC_GROUPS_CLAIM')).claims,
    orgClaim: envStr('OIDC_ORG_CLAIM'),
    scopes: parseExtraScopes(envStr('OIDC_EXTRA_SCOPES')).scopes,
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
  if (!envBool('SSO_ENABLED')) return null;

  const provider = envStr('SSO_PROVIDER').toLowerCase();
  if (!provider) {
    return 'SSO_ENABLED is set but SSO_PROVIDER is missing. Set SSO_PROVIDER=oidc.';
  }
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return `SSO_PROVIDER="${provider}" is not supported. Only "oidc" is available (SAML is on the roadmap).`;
  }

  const missing = [];
  if (!envStr('OIDC_ISSUER_URL')) missing.push('OIDC_ISSUER_URL');
  if (!envStr('OIDC_CLIENT_ID')) missing.push('OIDC_CLIENT_ID');
  if (!envStr('OIDC_CLIENT_SECRET')) missing.push('OIDC_CLIENT_SECRET');
  if (!envStr('OIDC_REDIRECT_URI')) missing.push('OIDC_REDIRECT_URI');
  if (missing.length) {
    return `SSO_ENABLED=true with SSO_PROVIDER=oidc but required OIDC settings are missing: ${missing.join(', ')}.`;
  }

  // Fail early on malformed URLs rather than at first login.
  for (const [name, value] of [
    ['OIDC_ISSUER_URL', envStr('OIDC_ISSUER_URL')],
    ['OIDC_REDIRECT_URI', envStr('OIDC_REDIRECT_URI')],
  ]) {
    try {
      // eslint-disable-next-line no-new
      new URL(value);
    } catch {
      return `${name}="${value}" is not a valid absolute URL.`;
    }
  }

  for (const { error } of [
    parseGroupsClaims(envStr('OIDC_GROUPS_CLAIM')),
    parseExtraScopes(envStr('OIDC_EXTRA_SCOPES')),
  ]) {
    if (error) return error;
  }

  return null;
}

/**
 * Parse `OIDC_GROUPS_CLAIM`: a comma-separated list of claims to read group
 * and role values from. Each entry is a claim name, or a dot path into a
 * nested claim (`realm_access.roles`). Claim names are case-sensitive, so the
 * entries are not lowercased. Unset or blank → the default `groups,roles`.
 *
 * An entry with an empty segment (`a..b`, `.roles`) cannot name a claim; it is
 * an error, reported at boot by {@link ssoConfigError} rather than turning
 * into an admin mapping that silently never matches.
 *
 * @param {string} raw - The env value.
 * @returns {{ claims: string[], error: string|null }}
 */
export function parseGroupsClaims(raw) {
  const entries = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entries.length) return { claims: DEFAULT_GROUPS_CLAIMS, error: null };
  const bad = entries.find((e) => e.split('.').some((seg) => !seg));
  if (bad) {
    return {
      claims: [],
      error:
        `OIDC_GROUPS_CLAIM entry "${bad}" has an empty path segment. ` +
        'Use a claim name or a dot path such as realm_access.roles.',
    };
  }
  return { claims: [...new Set(entries)], error: null };
}

/**
 * Parse `OIDC_EXTRA_SCOPES`: scopes requested on top of
 * {@link OIDC_BASE_SCOPES}, separated by whitespace like the OAuth `scope`
 * parameter itself (ZITADEL's organization claim needs
 * `urn:zitadel:iam:user:resourceowner`). A scope list is a set, so repeats
 * and a base scope listed again collapse. A comma is refused rather than
 * split on: it is the separator of every other list env, and sent verbatim it
 * would ask for one scope nobody means. Reported at boot by
 * {@link ssoConfigError}.
 *
 * @param {string} raw - The env value.
 * @returns {{ scopes: string[], error: string|null }} `scopes` is the full
 *   list to request, base scopes first.
 */
export function parseExtraScopes(raw) {
  const tokens = String(raw || '')
    .split(/\s+/)
    .filter(Boolean);
  const bad = tokens.find((t) => t.includes(',') || !SCOPE_TOKEN.test(t));
  if (bad) {
    return {
      scopes: [...OIDC_BASE_SCOPES],
      error:
        `OIDC_EXTRA_SCOPES entry "${bad}" is not a valid scope. ` +
        'Separate scopes with spaces, not commas.',
    };
  }
  return {
    scopes: [...new Set([...OIDC_BASE_SCOPES, ...tokens])],
    error: null,
  };
}

/**
 * Check that a redirect URI is the one this instance serves: the path must be
 * {@link OIDC_CALLBACK_PATH} and, when a public base URL is known, the origin
 * must be that of `APP_URL`/`DOMAIN`. A mismatch is the most common SSO
 * mistake and otherwise only shows at the first failed login.
 *
 * This is a warning, not a refusal: a reverse proxy may legitimately rewrite
 * the host or path. The message carries the expected URI verbatim so it can be
 * pasted into the IdP. Pure, so boot and a doctor can both call it.
 *
 * @param {{ redirectUri?: string, appBaseUrl?: string }} [input] - Defaults to
 *   `OIDC_REDIRECT_URI` and {@link getAppBaseUrl}.
 * @returns {{ ok: boolean, expected: string, message: string|null }}
 *   `expected` is '' when the redirect URI is not a valid URL.
 */
export function checkOidcRedirectUri({
  redirectUri = envStr('OIDC_REDIRECT_URI'),
  appBaseUrl = getAppBaseUrl(),
} = {}) {
  let actual;
  try {
    actual = new URL(redirectUri);
  } catch {
    return {
      ok: false,
      expected: '',
      message: `OIDC_REDIRECT_URI="${redirectUri}" is not a valid absolute URL.`,
    };
  }
  // An unparseable APP_URL is not this check's finding; compare paths only.
  const origin =
    appBaseUrl && URL.canParse(appBaseUrl)
      ? new URL(appBaseUrl).origin
      : actual.origin;
  const expected = `${origin}${OIDC_CALLBACK_PATH}`;
  if (actual.href === expected) return { ok: true, expected, message: null };

  const why = [];
  if (actual.pathname !== OIDC_CALLBACK_PATH) {
    why.push(`its path is not ${OIDC_CALLBACK_PATH}`);
  }
  if (actual.origin !== origin) {
    why.push(`its origin is not that of APP_URL (${origin})`);
  }
  if (!why.length) why.push('it carries a query or fragment');
  return {
    ok: false,
    expected,
    message:
      `OIDC_REDIRECT_URI="${redirectUri}" does not match this instance: ` +
      `${why.join(' and ')}. Set it, and register it at the IdP, as ` +
      `${expected} (ignore this if a reverse proxy rewrites the callback).`,
  };
}

/**
 * Non-fatal SSO warnings for boot. Only checks a config that
 * {@link ssoConfigError} accepted; a broken one never reaches boot.
 * @returns {string[]}
 */
export function ssoConfigWarnings() {
  if (!envBool('SSO_ENABLED') || ssoConfigError()) return [];
  const { message } = checkOidcRedirectUri();
  return message ? [message] : [];
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
    enforce: enabled && envBool('SSO_ENFORCE'),
    provider: enabled ? getSsoProvider() : null,
    loginPath: OIDC_LOGIN_PATH,
    // The words on the SSO button (SSO_BUTTON_LABEL), e.g. "Sign in with
    // Acme ID"; null = the client's own translated "Sign in with SSO".
    buttonLabel: (enabled && envStr('SSO_BUTTON_LABEL')) || null,
  };
}
