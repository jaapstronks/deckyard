/**
 * Shared storage helpers — small value functions no single store owns.
 * DRY: each of these was duplicated across stores before it moved here.
 */

import { getOrgId } from '../../utils/context.js';
import { resolveScope } from '../scope.js';
import { normalizeEmail } from '../../../shared/email.js';

export function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'object') return val; // already parsed by Kysely
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

/**
 * The id of the user with this e-mail address in the scope's organization.
 * `users.email` is stored through `normalizeEmail`, so the address is folded
 * the same way before the bare comparison: a mixed-case spelling finds the
 * same user (B664).
 * @param {import('../scope.js').StorageScope} scope
 * @param {import('kysely').Kysely<any>} db - The open handle or transaction
 * @param {string} email
 * @returns {Promise<string|null>}
 */
export async function getUserIdByEmail(scope, db, email) {
  const orgId = getOrgId(resolveScope(scope, 'getUserIdByEmail'));
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('email', '=', normalized)
    .executeTakeFirst();
  return user?.id || null;
}

/**
 * Escape a user-typed string so it matches itself inside a SQL `LIKE`/`ILIKE`
 * pattern.
 *
 * `LIKE` reads `%`, `_` and the escape character as syntax, so a search term
 * carrying one of those is a wildcard rather than a letter. Callers compose
 * the wildcards themselves (`${escapeLikePattern(term)}%` for a prefix match,
 * `%…%` for a contains match) — where the wildcard sits is the query's
 * business; what a typed character means is not.
 *
 * The escape character is the backslash: that is `LIKE`'s default in
 * PostgreSQL, fixed by the standard rather than by a setting, and the pattern
 * travels as a bound parameter, so no literal parsing happens on the way in.
 *
 * @param {string} value - Raw search term as the user typed it
 * @returns {string} - The same text, safe to embed in a LIKE pattern
 */
export function escapeLikePattern(value) {
  return String(value ?? '').replace(/[\\%_]/g, '\\$&');
}
