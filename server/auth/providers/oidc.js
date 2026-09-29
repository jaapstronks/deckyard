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
 * @see docs/reference/sso-oidc.md
 */

import * as client from 'openid-client';
import { getOidcConfig } from '../../config/sso.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('sso-oidc');

/** Tolerance (seconds) for ID-token iat/exp/nbf clock-skew checks. */
const CLOCK_TOLERANCE_SECONDS = 60;

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
    scope: oidc.scopes.join(' '),
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
export async function completeLogin(
  currentUrl,
  checks,
  oidc = getOidcConfig(),
) {
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
 * Resolve one `OIDC_GROUPS_CLAIM` entry against the claims. A claim whose name
 * is the whole entry wins (namespaced claims such as
 * `https://example.com/roles` contain dots); otherwise the entry is walked as
 * a dot path (`realm_access.roles`).
 * @param {object} claims
 * @param {string} entry
 * @returns {unknown}
 */
function resolveClaim(claims, entry) {
  if (claims && Object.hasOwn(claims, entry)) return claims[entry];
  let v = claims;
  for (const seg of entry.split('.')) {
    if (!v || typeof v !== 'object' || !Object.hasOwn(v, seg)) return undefined;
    v = v[seg];
  }
  return v;
}

/**
 * Collect group/role values from the configured claims into a lowercased list.
 * IdPs vary in where and how: a string or an array under `groups`/`roles`
 * (Entra, Okta, Google), an array nested under `realm_access.roles`
 * (Keycloak), or an object whose keys are the role names
 * (`urn:zitadel:iam:org:project:roles` in ZITADEL).
 * @param {object} claims
 * @param {string[]} groupsClaims - From {@link getOidcConfig}.
 * @returns {string[]}
 */
function extractGroups(claims, groupsClaims) {
  const out = [];
  for (const entry of groupsClaims) {
    const v = resolveClaim(claims, entry);
    if (Array.isArray(v)) out.push(...v.filter((x) => typeof x === 'string'));
    else if (typeof v === 'string') out.push(...v.split(/[\s,]+/));
    else if (v && typeof v === 'object') out.push(...Object.keys(v));
  }
  return [...new Set(out.map((s) => s.trim().toLowerCase()).filter(Boolean))];
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
 * @returns {{ email: string, name: string, isAdmin: boolean, groups: string[], externalOrgId: string | null }}
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
    throw new OidcError(
      'email_unverified',
      `Email ${email} is not verified at the IdP`,
    );
  }

  // Optional hosted-domain guard: restrict logins to configured domains.
  if (oidc.allowedDomains.length) {
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (!oidc.allowedDomains.includes(domain)) {
      throw new OidcError(
        'domain_not_allowed',
        `Domain ${domain} is not in OIDC_ALLOWED_DOMAINS`,
      );
    }
  }

  const groups = extractGroups(claims, oidc.groupsClaims);
  const isAdmin = oidc.adminGroups.length
    ? oidc.adminGroups.some((g) => groups.includes(g))
    : false;

  let externalOrgId = null;
  if (oidc.orgClaim) {
    const value = claims?.[oidc.orgClaim];
    if (typeof value !== 'string' || !value.trim()) {
      throw new OidcError(
        'org_claim_missing',
        'ID token has no organization claim',
      );
    }
    externalOrgId = value.trim();
  }

  return { email, name: extractName(claims), isAdmin, groups, externalOrgId };
}

/** Best-effort log of a discovery failure without leaking secrets. */
export function logDiscoveryFailure(err) {
  log.error('OIDC discovery/token exchange failed:', err?.message || err);
}
