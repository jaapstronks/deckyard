/**
 * The one spelling of an e-mail address that Deckyard stores and compares
 * (D200, B664).
 *
 * Every write boundary folds an address through {@link normalizeEmail}, and
 * every read compares the stored value bare against an address folded the
 * same way. A second fold anywhere else (`.toLowerCase()`, SQL `lower()`) is
 * a sign that a write path skipped this function; `tests/email-fold-sites.test.js`
 * refuses one. Migration 092 brought the rows written before that rule to the
 * same spelling.
 *
 * @module shared/email
 */

/**
 * Normalize an e-mail address: trimmed and lower-cased.
 * @param {unknown} email - The address as given; anything not a string with
 *   content counts as absent.
 * @returns {string|null} The normalized address, or null when nothing is left.
 */
export function normalizeEmail(email) {
  const s = String(email || '')
    .trim()
    .toLowerCase();
  return s || null;
}
