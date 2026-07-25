/**
 * Session-version derivation — the single source of truth.
 *
 * A session cookie carries a short `v` claim. On every authenticated request
 * the validator recomputes `v` from the user row and rejects the session when
 * the two disagree. That is how a password reset (or any user-row mutation)
 * invalidates sessions minted before it, without a server-side session store.
 *
 * Every minter (password login, magic link, SSO) and the validator must derive
 * `v` identically, so they all call this function. Before it existed the
 * calculation was copy-pasted across four call sites whose fallback behaviour
 * had already drifted apart, with hand-maintained "this must match X" comments
 * as the only safeguard.
 *
 * @see server/auth/auth.js (getUserFromRequestAsync, verifyDbCredentials)
 * @see server/storage/magic-link.js
 * @see server/storage/sso.js
 */

import crypto from 'node:crypto';

/** Version claim for a user row that carries no usable timestamp. */
const NO_TIMESTAMP = 'db';

/**
 * Derive the session-version claim for a user row.
 *
 * Note for static analysis: `password_changed_at` is a *timestamp*, not a
 * secret. SHA-256 is used here as a short, stable fingerprint of "when was
 * this user last invalidated", recomputed on every authenticated request. It
 * is deliberately not a password KDF — no password material passes through
 * this function, and a per-request KDF would be a pure performance loss.
 *
 * @param {{ password_changed_at?: string|Date|null, updated_at?: string|Date|null }} row
 *   User row from the database.
 * @returns {string} 12-character base64url digest, or `'db'` when the row has
 *   neither timestamp.
 */
export function sessionVersion(row) {
  const source = row?.password_changed_at || row?.updated_at;
  if (!source) return NO_TIMESTAMP;
  return crypto
    .createHash('sha256')
    .update(String(source))
    .digest('base64url')
    .slice(0, 12);
}
