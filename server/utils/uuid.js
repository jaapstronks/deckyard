/**
 * The one UUID shape check (A7.19-C7h).
 *
 * Postgres `uuid` columns raise `invalid input syntax` (22P02) — a 500 — when
 * queried with a non-uuid string, so every id that reaches storage straight
 * from a URL or request body must be shape-checked first: a value that cannot
 * be a uuid cannot name a row, and the honest answer is `not_found`.
 */

/** Canonical 8-4-4-4-12 hex UUID pattern. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this value shaped like a UUID?
 * @param {*} value
 * @returns {boolean}
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
