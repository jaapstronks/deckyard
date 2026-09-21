/**
 * Shared storage helpers — small value functions no single store owns.
 * DRY: each of these was duplicated across stores before it moved here.
 */

const MAX_SLUG_LEN = 80;

export function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'object') return val; // already parsed by Kysely
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

export function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN);
}

export function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.length > MAX_SLUG_LEN) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

export async function getUserIdByEmail(db, orgId, email) {
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('email', '=', email)
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
