/**
 * GDPR self-service verification token store.
 *
 * The durable backing for the lead my-data flow: a short-lived token, mailed to
 * the address that requested its data, proves ownership of that address for the
 * `GET`/`DELETE /api/leads/my-data` routes. Backed by the
 * `gdpr_verification_tokens` table (migration 075) rather than an in-process
 * `Map`, so a token survives a restart and validates across a scaled-out
 * deployment — the same shape as the analytics track-erase token, which is a DB
 * row too.
 *
 * One active token per address: `storeGdprToken` upserts on the `email` primary
 * key, so a fresh request replaces any earlier token for that address.
 */

import crypto from 'node:crypto';
import { withDbGuard } from './utils/db-guard.js';
import { nowIso } from '../utils/normalize.js';

/**
 * Store (or replace) the active verification token for an address.
 * @param {Object} args
 * @param {string} args.email - The address that requested its data (lowercased).
 * @param {string} args.token - The hex verification token.
 * @param {number} args.expiresAt - Absolute expiry, epoch milliseconds.
 * @returns {Promise<{ok: boolean}>}
 */
export async function storeGdprToken({ email, token, expiresAt }) {
  const e = String(email || '').toLowerCase().trim();
  const t = String(token || '');
  if (!e || !t) return { ok: false };

  const expiresIso = new Date(expiresAt).toISOString();

  return withDbGuard({ ok: false }, async (db) => {
    await db
      .insertInto('gdpr_verification_tokens')
      .values({ email: e, token: t, expires_at: expiresIso, created_at: nowIso() })
      .onConflict((oc) =>
        oc.column('email').doUpdateSet({ token: t, expires_at: expiresIso, created_at: nowIso() })
      )
      .execute();
    return { ok: true };
  });
}

/**
 * Verify a supplied (email, token) pair against the stored token.
 *
 * The comparison is constant-time (`crypto.timingSafeEqual`) so a timing side
 * channel cannot be used to recover the token byte by byte. An unknown address
 * or an expired row is a plain `false`; the caller maps that to the same
 * "invalid or expired" response either way, so nothing about which addresses
 * hold tokens leaks.
 * @param {Object} args
 * @param {string} args.email - The address under check (lowercased).
 * @param {string} args.token - The supplied token.
 * @returns {Promise<boolean>} True only if the token matches and is unexpired.
 */
export async function verifyGdprToken({ email, token }) {
  const e = String(email || '').toLowerCase().trim();
  const t = String(token || '');
  if (!e || !t) return false;

  return withDbGuard(false, async (db) => {
    const row = await db
      .selectFrom('gdpr_verification_tokens')
      .select(['token', 'expires_at'])
      .where('email', '=', e)
      .executeTakeFirst();

    if (!row) return false;
    if (new Date(row.expires_at).getTime() < Date.now()) return false;
    return timingSafeEqualStr(row.token, t);
  });
}

/**
 * Burn the token for an address (called after a successful erase).
 * @param {string} email - The address whose token is spent.
 * @returns {Promise<void>}
 */
export async function consumeGdprToken(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return;
  await withDbGuard(undefined, async (db) => {
    await db.deleteFrom('gdpr_verification_tokens').where('email', '=', e).execute();
  });
}

/**
 * Sweep expired tokens. Called opportunistically on the request path so the
 * table does not accumulate dead rows (the old in-memory store did the same
 * inline on every mint).
 * @returns {Promise<void>}
 */
export async function deleteExpiredGdprTokens() {
  await withDbGuard(undefined, async (db) => {
    await db.deleteFrom('gdpr_verification_tokens').where('expires_at', '<', nowIso()).execute();
  });
}

/**
 * Length-checked constant-time string comparison. The length guard is not a
 * secret leak here: the token length is a fixed public constant (64 hex chars).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
