/**
 * OIDC provider for Track 1 SSO (self-hosted, single IdP). Wraps the
 * `openid-client` library so the rest of the codebase deals in plain identity
 * objects, never in tokens or discovery documents.
 *
 * Split of concerns:
 *  - Network/protocol (discovery, authz-URL build, code exchange, ID-token
 *    verification) lives in the exported async functions here and leans on
 *    `openid-client` for all the security-critical crypto.
 *  - Pure claim -> identity mapping ({@link mapClaimsToIdentity}) has no I/O and
 *    is unit-tested directly.
 *
 * @see docs/plans/briefs/sso-integration.md (Track 1, "Claim -> identity mapping")
 */

import * as client from 'openid-client';
import { getOidcConfig } from '../../config/sso.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('sso-oidc');

/** Tolerance (seconds) for ID-token iat/exp/nbf clock-skew checks. */
const CLOCK_TOLERANCE_SECONDS = 60;

/** OIDC scopes requested. `email` is the ACL key; `profile` gives us `name`. */
const SCOPE = 'openid email profile';

/**
 * Discovery is network I/O and its result (endpoints + JWKS handle) is stable
 * for the lifetime of a process, so we memoize the Configuration per
 * issuer+client. Keyed so a config change between tests/reloads re-discovers.
 * @type {Map<string, Promise<import('openid-client').Configuration>>}
 */
const configCache = new Map();

/**
 * Resolve (and cache) the discovered OIDC client configuration.
 * @param {object} [oidc] - Config from {@link getOidcConfig}; read fresh if omitted.
 * @returns {Promise<import('openid-client').Configuration>}
 */
export async function getOidcClientConfig(oidc = getOidcConfig()) {
  const key = `${oidc.issuerUrl}|${oidc.clientId}`;
  let pending = configCache.get(key);
  if (!pending) {
    pending = client
      .discovery(new URL(oidc.issuerUrl), oidc.clientId, oidc.clientSecret)
      .then((config) => {
        // Apply a modest clock tolerance for ID-token time-claim validation.
        config[client.clockTolerance] = CLOCK_TOLERANCE_SECONDS;
        return config;
      })
      .catch((err) => {
        // Don't cache a failed discovery — a transient IdP outage shouldn't
        // wedge SSO until restart.
        configCache.delete(key);
        throw err;
      });
    configCache.set(key, pending);
  }
  return pending;
}

/** Clear the discovery cache (test hook / config reload). */
export function resetOidcClientConfigCache() {
  configCache.clear();
}

/**
 * Build the authorization-request URL plus the per-request secrets that must be
 * echoed back and checked at the callback (PKCE verifier, state, nonce).
 *
 * @param {object} [oidc] - Config from {@link getOidcConfig}.
 * @returns {Promise<{ url: string, state: string, nonce: string, codeVerifier: string }>}
 */
export async function buildLoginRequest(oidc = getOidcConfig()) {
  const config = await getOidcClientConfig(oidc);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: oidc.redirectUri,
    scope: SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return { url: url.href, state, nonce, codeVerifier };
}

/**
 * Complete the authorization-code flow: exchange the code, verify the ID-token
 * signature / issuer / audience / nonce, and return its claims.
 *
 * @param {URL|string} currentUrl - The full callback URL as received.
 * @param {{ codeVerifier: string, expectedState: string, expectedNonce: string }} checks
 * @param {object} [oidc] - Config from {@link getOidcConfig}.
 * @returns {Promise<object>} The verified ID-token claims.
 */
export async function completeLogin(currentUrl, checks, oidc = getOidcConfig()) {
  const config = await getOidcClientConfig(oidc);
  const url = typeof currentUrl === 'string' ? new URL(currentUrl) : currentUrl;

  const tokens = await client.authorizationCodeGrant(config, url, {
    pkceCodeVerifier: checks.codeVerifier,
    expectedState: checks.expectedState,
    expectedNonce: checks.expectedNonce,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!claims) {
    throw new OidcError('no_id_token', 'IdP response contained no ID token');
  }
  return claims;
}

/**
 * Error type for identity-mapping failures, carrying a stable machine reason so
 * routes can log/branch without string-matching.
 */
export class OidcError extends Error {
  /** @param {string} reason @param {string} [message] */
  constructor(reason, message) {
    super(message || reason);
    this.name = 'OidcError';
    this.reason = reason;
  }
}

/**
 * Collect group/role claim values into a lowercased list. IdPs vary: some emit
 * `groups`, some `roles`, as a string or an array.
 * @param {object} claims
 * @returns {string[]}
 */
function extractGroups(claims) {
  const out = [];
  for (const key of ['groups', 'roles']) {
    const v = claims?.[key];
    if (Array.isArray(v)) out.push(...v);
    else if (typeof v === 'string' && v) out.push(...v.split(/[\s,]+/));
  }
  return [...new Set(out.map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
}

/**
 * Derive a display name from standard OIDC claims.
 * @param {object} claims
 * @returns {string}
 */
function extractName(claims) {
  const name = String(claims?.name || '').trim();
  if (name) return name;
  const parts = [claims?.given_name, claims?.family_name]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  return parts.join(' ');
}

/**
 * Map verified ID-token claims to a Deckyard identity, applying the security
 * gates: email must be present AND verified, and the hosted-domain allowlist
 * (if configured) must match. Throws {@link OidcError} on any gate failure.
 *
 * Pure function — no I/O — so it is unit-tested directly.
 *
 * @param {object} claims - Verified ID-token claims.
 * @param {object} [oidc] - Config from {@link getOidcConfig}.
 * @returns {{ email: string, name: string, isAdmin: boolean, groups: string[] }}
 */
export function mapClaimsToIdentity(claims, oidc = getOidcConfig()) {
  const email = normalizeEmail(claims?.email);
  if (!email) {
    throw new OidcError('no_email', 'ID token has no email claim');
  }

  // Reject unverified emails: email is our ACL key, so an unverified address
  // would let anyone who can set an arbitrary (unverified) email at the IdP
  // impersonate a Deckyard account. `email_verified` may be boolean or the
  // string "true" depending on the IdP.
  const verified =
    claims.email_verified === true ||
    String(claims.email_verified).toLowerCase() === 'true';
  if (!verified) {
    throw new OidcError('email_unverified', `Email ${email} is not verified at the IdP`);
  }

  // Optional hosted-domain guard: restrict logins to configured domains.
  if (oidc.allowedDomains.length) {
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (!oidc.allowedDomains.includes(domain)) {
      throw new OidcError('domain_not_allowed', `Domain ${domain} is not in OIDC_ALLOWED_DOMAINS`);
    }
  }

  const groups = extractGroups(claims);
  const isAdmin = oidc.adminGroups.length
    ? oidc.adminGroups.some((g) => groups.includes(g))
    : false;

  return { email, name: extractName(claims), isAdmin, groups };
}

/** Best-effort log of a discovery failure without leaking secrets. */
export function logDiscoveryFailure(err) {
  log.error('OIDC discovery/token exchange failed:', err?.message || err);
}
