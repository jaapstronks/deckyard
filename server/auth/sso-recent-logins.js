/**
 * The claims of the most recent SSO logins, kept in process memory so an
 * instance admin can see what the identity provider sent without devtools
 * (B551, punt 4 of the B427 briefing).
 *
 * Setting up `OIDC_ADMIN_GROUPS`, `OIDC_GROUPS_CLAIM` or `OIDC_ORG_CLAIM`
 * means knowing where a provider puts things, and that differs per provider
 * and per app registration. The answer is in the verified ID-token claims of
 * a login, refused or not, so the callback hands them here and the admin
 * route reads them back.
 *
 * What is kept, and what is not:
 *
 *   - The verified ID-token **claims** only, never a token: the raw ID token,
 *     access token and refresh token never reach this module. The
 *     replay-binding claims (`nonce`, `at_hash`, `c_hash`) and the IdP
 *     session id (`sid`) are dropped as well; they say nothing about
 *     configuration.
 *   - Memory only. Nothing is written to disk, the database or the log, so a
 *     restart forgets it and a second instance has its own list.
 *   - At most {@link MAX_ENTRIES} logins, none older than {@link TTL_MS}.
 *
 * @see server/routes/api/admin-sso.js (the reader)
 * @see docs/reference/sso-oidc.md § Inspecting the claims of a login
 */

/** How many logins the list holds; the oldest drops off first. */
export const MAX_ENTRIES = 10;

/** How long a login stays in the list. */
export const TTL_MS = 24 * 60 * 60 * 1000;

/** Claims that bind a token to one exchange or session, not to a person. */
const DROPPED_CLAIMS = new Set(['nonce', 'at_hash', 'c_hash', 'sid']);

/**
 * @typedef {Object} SsoLoginRecord
 * @property {string} at - ISO timestamp of the login.
 * @property {string|null} email - The email claim, as sent.
 * @property {string} outcome - `ok`, or the refusal reason the login page shows.
 * @property {Object} claims - The ID-token claims minus {@link DROPPED_CLAIMS}.
 */

/** @type {Array<SsoLoginRecord & { time: number }>} newest first */
let entries = [];

/**
 * Remember the claims of one login.
 *
 * @param {Object} claims - Verified ID-token claims.
 * @param {string} outcome - `ok` or the refusal reason.
 * @param {number} [now] - Clock, for tests.
 */
export function recordSsoLogin(claims, outcome, now = Date.now()) {
  const kept = {};
  for (const [key, value] of Object.entries(claims || {})) {
    if (!DROPPED_CLAIMS.has(key)) kept[key] = value;
  }
  entries.unshift({
    time: now,
    at: new Date(now).toISOString(),
    email: typeof claims?.email === 'string' ? claims.email : null,
    outcome,
    claims: kept,
  });
  entries.length = Math.min(entries.length, MAX_ENTRIES);
}

/**
 * The remembered logins that have not expired, newest first.
 *
 * @param {number} [now] - Clock, for tests.
 * @returns {SsoLoginRecord[]}
 */
export function listRecentSsoLogins(now = Date.now()) {
  entries = entries.filter((e) => now - e.time < TTL_MS);
  return entries.map(({ at, email, outcome, claims }) => ({
    at,
    email,
    outcome,
    claims: structuredClone(claims),
  }));
}

/** Forget every login (test hook). */
export function resetRecentSsoLogins() {
  entries = [];
}
