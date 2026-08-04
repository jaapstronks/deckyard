/**
 * Follow-code storage.
 *
 * A follow code is a short, human-typable handle for a live follow URL: the
 * audience types five letters instead of a link. Codes live in the
 * `follow_codes` table (widened from the dormant 001 schema by migration 060),
 * one row per code, expiring 24 hours after they are minted.
 *
 * They used to be a `follow-codes.json` blob rewritten in full on every mint —
 * a non-atomic write (no tmp+rename) whose `cleanupExpiredCodes` nothing ever
 * called, so the file only grew. A row per code makes the mint a single insert
 * and the cleanup a `DELETE`, run by the live-session sweep.
 *
 * The facade is unchanged: every function still takes `repoRoot` first for
 * call-site stability, but that argument is now unused — persistence no longer
 * touches disk.
 */

import crypto from 'node:crypto';
import { withDbGuard } from './utils/db-guard.js';

// Follow codes are guessable live-session handles: a valid one resolves to a
// presenter's live follow URL. Use a CSPRNG (not Math.random, which is
// predictable) over a large-enough keyspace. 21 unambiguous letters ^ 5 chars
// ≈ 4.08M combinations, so the 60/hr/IP resolve throttle keeps guessing
// infeasible. See security audit M3.
const CODE_LENGTH = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPRTUVWXY';

/**
 * How long a minted code stays resolvable. Present sessions use the same
 * window (`present-sessions/constants.js` TTL_MS), so a code outlives the
 * session it was minted for by no more than the session's own idle grace.
 */
export const FOLLOW_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** How many collisions to ride out before giving up on a unique code. */
const MAX_MINT_ATTEMPTS = 100;

/**
 * Mint a random code. The alphabet excludes glyphs that are easy to misread:
 * O/0, I/1, Q/O, S/5, Z/2.
 * @returns {string}
 */
export function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Create a follow code for a follow URL.
 *
 * Uniqueness is the primary key's job: each attempt inserts with
 * `ON CONFLICT DO NOTHING` and retries on a collision, so two processes minting
 * at the same instant can never hand out the same code. An expired row still
 * occupies its code until the sweep removes it; that costs a retry, which at a
 * 4M keyspace is not a cost worth engineering around.
 *
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @param {string} followUrl - The `/follow/...` URL the code resolves to.
 * @returns {Promise<string|null>} The code, or null when the database is
 *   unavailable.
 */
export async function createFollowCode(repoRoot, followUrl) {
  return withDbGuard(null, async (db) => {
    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
      const createdAt = new Date();
      const inserted = await db
        .insertInto('follow_codes')
        .values({
          code: generateCode(),
          follow_url: followUrl,
          created_at: createdAt,
          expires_at: new Date(createdAt.getTime() + FOLLOW_CODE_TTL_MS),
        })
        .onConflict((oc) => oc.column('code').doNothing())
        .returning('code')
        .executeTakeFirst();
      if (inserted?.code) return inserted.code;
    }
    throw new Error('Unable to generate unique follow code');
  });
}

/**
 * Resolve a code to its follow URL, or null when it is unknown or expired.
 *
 * An expired hit is deleted on the way out, so a code that leaked stops
 * resolving the moment someone tries it rather than at the next sweep. Nothing
 * here logs the code or the URL: a live code resolves to a presenter's follow
 * URL, so both are secrets (audit L2).
 *
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @param {string} code - The code as typed; matched case-insensitively.
 * @returns {Promise<string|null>}
 */
export async function resolveFollowCode(repoRoot, code) {
  const upperCode = String(code || '').toUpperCase();
  if (!upperCode) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('follow_codes')
      .select(['follow_url', 'expires_at'])
      .where('code', '=', upperCode)
      .executeTakeFirst();
    if (!row) return null;

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await db.deleteFrom('follow_codes').where('code', '=', upperCode).execute();
      return null;
    }

    return row.follow_url;
  });
}

/**
 * Delete every expired code. Called by the live-session sweep
 * (`utils/live-session-cleanup.js`); the file-backed predecessor of this
 * function was never called at all, which is why the JSON blob only grew.
 *
 * @param {string} [repoRoot] - Unused; retained for facade-API stability.
 * @returns {Promise<number>} How many codes were removed.
 */
export async function cleanupExpiredCodes(repoRoot) {
  const now = new Date().toISOString();
  return withDbGuard(0, async (db) => {
    const result = await db
      .deleteFrom('follow_codes')
      .where('expires_at', '<=', now)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0);
  });
}
